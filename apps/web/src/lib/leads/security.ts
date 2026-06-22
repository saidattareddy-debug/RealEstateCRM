import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Ingestion security helpers (MASTER_SPEC §28, Phase 3.1 §4–5). */

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time hex comparison. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** API-key auth: the stored value is a sha256 hash; the client sends the key. */
export function verifyApiKey(storedHash: string | null, providedKey: string | null): boolean {
  if (!storedHash || !providedKey) return false;
  return safeEqualHex(storedHash, sha256Hex(providedKey));
}

/** HMAC-SHA256 signature verification (for live provider webhooks). */
export function verifyHmac(secret: string, rawBody: string, signatureHex: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signatureHex);
}

/** Reject stale/replayed requests outside the tolerance window. */
export function timestampWithinTolerance(
  tsHeader: string | null,
  toleranceSec = 300,
  now: number = Date.now(),
): boolean {
  if (!tsHeader) return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return false;
  // Accept seconds or milliseconds.
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  return Math.abs(now - tsMs) <= toleranceSec * 1000;
}

/** Origin allow-list check (empty list = allow none for hosted forms). */
export function originAllowed(allowed: string[], origin: string | null): boolean {
  if (!origin) return false;
  if (allowed.length === 0) return false;
  return allowed.some((a) => a === origin || a === '*');
}

/**
 * Origin check for the website-chat widget: the embeddable iframe is served from
 * the app's OWN origin, so its first-party fetches carry the app origin. Allow
 * that, a missing origin, or any configured external origin. (Production
 * enforcement of the embedding parent domain is a refinement — see WEBSITE_CHAT.)
 */
export function widgetOriginAllowed(
  allowed: string[],
  origin: string | null,
  selfOrigin: string,
): boolean {
  if (!origin) return true;
  if (origin === selfOrigin) return true;
  return allowed.length > 0 && allowed.some((a) => a === origin || a === '*');
}

/** Generic, non-disclosing error envelope (never leak existence/internal detail). */
export function safeJson(status: number, code: string, requestId: string) {
  return Response.json({ error: { code, requestId } }, { status });
}
