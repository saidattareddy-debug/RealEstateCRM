import { z } from 'zod';

/**
 * Per-event-type normalized-payload schemas + data minimization (Phase 7A).
 *
 * Integration events must NOT persist a full provider payload in
 * `normalized_payload`. Each event type has an allow-listed schema; unknown keys
 * are stripped, fields are length-capped, the serialized size is bounded, and any
 * secret-bearing value (auth header, token, cookie, key) routes the event to
 * review instead of being stored. After processing, callers should prefer storing
 * references to the resulting lead/contact/conversation/message/delivery records.
 */

export type NormalizedEventType =
  | 'lead_created'
  | 'lead_updated'
  | 'inbound_message'
  | 'message_accepted'
  | 'message_sent'
  | 'message_delivered'
  | 'message_read'
  | 'message_failed'
  | 'attachment_received'
  | 'template_updated'
  | 'account_state_changed'
  | 'consent_or_optout'
  | 'mailbox_changed'
  | 'unsupported_event';

/** Maximum serialized size of a stored normalized payload (bytes). */
export const MAX_NORMALIZED_BYTES = 8192;
const SHORT = 256;
const REF = 512;
const TEXT = 4096;

// Patterns that must NEVER appear in a stored normalized payload.
const SECRET_PATTERNS: RegExp[] = [
  /\bbearer\s+[a-z0-9._-]{8,}/i,
  /\bauthorization\b\s*[:=]/i,
  /\bcookie\b\s*[:=]/i,
  /set-cookie/i,
  /\bsk-[a-z0-9]{16,}/i,
  /\bEAA[a-z0-9]{20,}/i, // Meta
  /\bya29\.[a-z0-9_-]{10,}/i, // Google access token
  /\bAIza[a-z0-9_-]{20,}/i, // Google API key
  /\bGOCSPX-[a-z0-9_-]{10,}/i, // Google client secret
  /\b1\/\/[a-z0-9_-]{20,}/i, // OAuth refresh
  /xox[baprs]-[a-z0-9-]{10,}/i, // Slack
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// Over-long fields are TRUNCATED (minimized), not rejected — a single noisy field
// must not discard the whole event. Hard size/secret limits are enforced after.
const str = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.slice(0, max));
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^\d+]/g, '').slice(0, SHORT));
const email = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.slice(0, SHORT));
const isoDate = z
  .string()
  .trim()
  .transform((v) => v.slice(0, 40));

// strip() (the Zod default) drops unknown keys → allow-list enforcement.
const leadSchema = z.object({
  leadRef: str(REF).optional(),
  name: str(SHORT).optional(),
  phone: phone.optional(),
  email: email.optional(),
  projectRef: str(REF).optional(),
  sourceCampaign: str(REF).optional(),
  message: str(TEXT).optional(),
});
const messageSchema = z.object({
  text: str(TEXT).optional(),
  contentKind: str(SHORT).optional(),
  mediaRef: str(REF).optional(),
  mediaType: str(SHORT).optional(),
});
const callbackSchema = z.object({
  providerMessageId: str(REF).optional(),
  status: str(SHORT).optional(),
  reasonCode: str(SHORT).optional(),
  occurredAt: isoDate.optional(),
});
const attachmentSchema = z.object({
  attachmentRef: str(REF).optional(),
  mimeType: str(SHORT).optional(),
  byteSize: z.number().int().nonnegative().max(2_000_000_000).optional(),
});
const templateSchema = z.object({
  templateName: str(REF).optional(),
  status: str(SHORT).optional(),
  language: str(SHORT).optional(),
});
const accountSchema = z.object({
  accountRef: str(REF).optional(),
  state: str(SHORT).optional(),
});
const consentSchema = z.object({
  contactRef: str(REF).optional(),
  consentState: str(SHORT).optional(),
  channel: str(SHORT).optional(),
});
const mailboxSchema = z.object({
  historyId: str(REF).optional(),
  cursor: str(REF).optional(),
});
const emptySchema = z.object({});

const SCHEMAS: Record<NormalizedEventType, z.ZodTypeAny> = {
  lead_created: leadSchema,
  lead_updated: leadSchema,
  inbound_message: messageSchema,
  message_accepted: callbackSchema,
  message_sent: callbackSchema,
  message_delivered: callbackSchema,
  message_read: callbackSchema,
  message_failed: callbackSchema,
  attachment_received: attachmentSchema,
  template_updated: templateSchema,
  account_state_changed: accountSchema,
  consent_or_optout: consentSchema,
  mailbox_changed: mailboxSchema,
  unsupported_event: emptySchema,
};

export interface MinimizeResult {
  ok: boolean;
  /** The allow-listed, length-capped payload safe to persist (null when review). */
  minimized: Record<string, unknown> | null;
  /** True when the event must go to review instead of being stored as-is. */
  review: boolean;
  reason?: 'secret_detected' | 'oversized' | 'invalid_shape';
}

function containsSecret(value: unknown): boolean {
  if (typeof value === 'string') return SECRET_PATTERNS.some((re) => re.test(value));
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') return Object.values(value).some(containsSecret);
  return false;
}

/**
 * Validate + minimize a normalized payload for a given event type. Drops unknown
 * keys, caps lengths, rejects secret-bearing values, and bounds serialized size.
 */
export function minimizeNormalizedPayload(
  eventType: NormalizedEventType,
  payload: unknown,
): MinimizeResult {
  // Secret-bearing payloads never get stored — route to review.
  if (containsSecret(payload)) {
    return { ok: false, minimized: null, review: true, reason: 'secret_detected' };
  }
  const schema = SCHEMAS[eventType] ?? emptySchema;
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) {
    return { ok: false, minimized: null, review: true, reason: 'invalid_shape' };
  }
  // Drop undefined keys so the stored object is minimal.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_NORMALIZED_BYTES) {
    return { ok: false, minimized: null, review: true, reason: 'oversized' };
  }
  return { ok: true, minimized: clean, review: false };
}

/** Allow-listed inbound HTTP headers safe to retain as diagnostics (never auth). */
export const ALLOWED_DIAGNOSTIC_HEADERS = [
  'content-type',
  'content-length',
  'user-agent',
  'x-request-id',
] as const;
