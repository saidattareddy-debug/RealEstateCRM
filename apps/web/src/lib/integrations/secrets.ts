import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Secret-ref resolution (server-only). A `secret_ref` is a STABLE REFERENCE to a
 * secret held outside the database — never the secret itself. In Phase 7A the
 * secret is resolved from an environment variable named by the ref; the resolved
 * value is used only to compute an HMAC and is NEVER returned to a caller,
 * persisted, audited, or logged.
 *
 * The DB stores only `secret_ref` + safe metadata (migration 0024). This module
 * is the single choke point translating a ref → bytes, kept tiny on purpose.
 */

/** Resolve a secret-ref to its raw bytes, or null when unset. Never logged. */
function resolveSecret(secretRef: string | null | undefined): string | null {
  if (!secretRef) return null;
  // Refs are env-var names (e.g. "WHATSAPP_ACCESS_TOKEN"). Only A-Z0-9_ allowed.
  if (!/^[A-Z0-9_]+$/.test(secretRef)) return null;
  const value = process.env[secretRef];
  return value && value.length > 0 ? value : null;
}

/**
 * Compute the server-side HMAC-SHA256 (hex) over the raw request body using the
 * secret resolved from `secretRef`. Returns null when no secret is configured.
 * The secret never leaves this function.
 */
export function computeWebhookSignature(
  secretRef: string | null | undefined,
  rawBody: string,
): string | null {
  const secret = resolveSecret(secretRef);
  if (!secret) return null;
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Whether a secret-ref currently resolves to a configured value (boolean only). */
export function secretRefConfigured(secretRef: string | null | undefined): boolean {
  return resolveSecret(secretRef) !== null;
}
