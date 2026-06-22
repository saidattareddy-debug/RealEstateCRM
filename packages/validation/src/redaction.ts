/**
 * Log-safe redaction helpers. Use these before anything reaches a log line or an
 * error-monitoring payload. Logs must NEVER contain service-role keys, access or
 * refresh tokens, authorization headers, cookies, session tokens, provider
 * webhook/HMAC secrets, full customer message bodies, raw integration payloads,
 * or full phone/email where not required.
 */

const TOKEN_PATTERNS: RegExp[] = [
  /\bbearer\s+[a-z0-9._-]{8,}/gi,
  /\bsk-[a-z0-9]{16,}/gi,
  /\bEAA[a-z0-9]{20,}/gi,
  /\bya29\.[a-z0-9_-]{10,}/gi,
  /\bAIza[a-z0-9_-]{20,}/gi,
  /\bGOCSPX-[a-z0-9_-]{10,}/gi,
  /\b1\/\/[a-z0-9_-]{20,}/gi,
  /xox[baprs]-[a-z0-9-]{10,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-hub-signature-256',
  'x-signature-256',
  'proxy-authorization',
]);

/** Replace any token-shaped substrings with `[redacted]`. */
export function redactTokens(text: string): string {
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/** `+919876540001` → `•••••••0001` (keep at most the last 4 digits). */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '•'.repeat(digits.length);
  return '•'.repeat(digits.length - 4) + digits.slice(-4);
}

/** `asha@example.com` → `a•••@example.com` (keep first char + domain). */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return '•••';
  return email[0] + '•••' + email.slice(at);
}

/** Drop sensitive header values; pass others through. */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase())
      ? '[redacted]'
      : redactTokens(Array.isArray(v) ? v.join(', ') : v);
  }
  return out;
}

/** Strip `user:pass@` credentials and secret-bearing query params from a URL. */
export function redactUrlCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const key of ['token', 'access_token', 'refresh_token', 'api_key', 'key', 'secret']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '[redacted]');
    }
    return u.toString();
  } catch {
    return redactTokens(url);
  }
}

/** Keep only a safe `{ code, message }` (tokens stripped) from a provider error. */
export function redactProviderError(err: unknown): { code: string | null; message: string } {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = e.code != null ? String(e.code) : e.status != null ? String(e.status) : null;
  const message = e.message != null ? redactTokens(String(e.message)).slice(0, 300) : '';
  return { code, message };
}
