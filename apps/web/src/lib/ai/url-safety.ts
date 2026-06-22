/**
 * SSRF guard for ingest-by-URL (Phase 5A §15, docs/SECURITY.md).
 *
 * Pure & unit-testable. Rejects anything that could let an attacker pivot the
 * server into the internal network or cloud metadata service:
 *   - non-http(s) schemes (file:, gopher:, data:, ftp:, etc.)
 *   - credentials embedded in the URL (user:pass@host)
 *   - localhost / loopback (127.0.0.0/8, ::1)
 *   - private ranges (10/8, 172.16-31/12, 192.168/16)
 *   - link-local (169.254/16, fe80::/10) incl. the 169.254.169.254 metadata IP
 *   - unique-local IPv6 (fc00::/7)
 *   - bare hostnames that resolve to "localhost"
 *
 * NOTE: this validates the literal URL only. A production fetch path must ALSO
 * re-validate the resolved IP after DNS (and on each redirect) to defeat
 * DNS-rebinding — that belongs in the durable fetch worker, not this pure guard.
 */

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  if (octets.some((o) => o === undefined || Number.isNaN(o) || o < 0 || o > 255)) return true; // malformed -> reject
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + metadata (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(rawHost: string): boolean {
  // Hostnames may arrive bracketed ("[::1]") via URL.hostname (unbracketed).
  const host = rawHost.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::1' || host === '::') return true; // loopback / unspecified
  if (
    host.startsWith('fe80') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  ) {
    return true; // link-local fe80::/10
  }
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local fc00::/7
  // IPv4-mapped IPv6 (::ffff:169.254.169.254) - extract trailing IPv4.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (v4 && v4[1] && isPrivateIpv4(v4[1])) return true;
  return false;
}

/** Validate a user-supplied URL before any server-side fetch. */
export function validateExternalUrl(url: string): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: 'scheme_not_allowed' };
  }

  // Credentials in the URL (user:pass@host) are an exfiltration / SSRF vector.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials_in_url' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'empty_host' };
  if (PRIVATE_HOSTNAMES.has(host)) return { ok: false, reason: 'loopback_host' };
  if (host.endsWith('.localhost')) return { ok: false, reason: 'loopback_host' };
  if (isPrivateIpv4(host)) return { ok: false, reason: 'private_or_loopback_ip' };
  if (isPrivateIpv6(host)) return { ok: false, reason: 'private_or_loopback_ip' };
  // Common cloud metadata hostnames.
  if (host === 'metadata' || host === 'metadata.google.internal') {
    return { ok: false, reason: 'metadata_host' };
  }

  return { ok: true };
}
