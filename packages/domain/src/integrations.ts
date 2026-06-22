/**
 * Phase 7A — external integration foundation (pure domain).
 *
 * Provider-neutral contracts + the normalization, webhook-security, idempotency,
 * WhatsApp/email/portal, health and replay logic that every adapter funnels
 * through BEFORE any lead/conversation service runs. No IO, no network, no
 * credentials. Everything here is mock/simulation/record-only — Phase 7A never
 * performs external IO and never sends a customer message.
 */

import { fnv1aHex } from './chunking';

// ---------------------------------------------------------------------------
// Provider / kind / status / capability
// ---------------------------------------------------------------------------

export const INTEGRATION_PROVIDERS = [
  'whatsapp_cloud',
  'gmail',
  'imap_email',
  'meta_lead_ads',
  'google_lead_forms',
  'nobroker',
  'ninetynine_acres',
  'housing',
  'magicbricks',
  'generic_portal',
  'generic_webhook',
  'generic_api',
  'manual_test',
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = [
  'draft',
  'unconfigured',
  'test',
  'connected',
  'degraded',
  'disabled',
  'revoked',
  'error',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Statuses an integration may hold in Phase 7A (no real provider verification). */
export const PHASE_7A_ALLOWED_STATUSES: IntegrationStatus[] = [
  'draft',
  'unconfigured',
  'test',
  'disabled',
];

export type IntegrationCapability =
  | 'lead_ingestion'
  | 'inbound_messages'
  | 'outbound_human_messages'
  | 'delivery_callbacks'
  | 'read_callbacks'
  | 'attachments'
  | 'templates'
  | 'mailbox_sync'
  | 'campaign_attribution';

// ---------------------------------------------------------------------------
// Normalized external event envelope
// ---------------------------------------------------------------------------

export type NormalizedExternalEventType =
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

export interface ExternalSubject {
  leadRef?: string;
  conversationRef?: string;
  contactPhone?: string;
  contactEmail?: string;
  externalContactId?: string;
}

export interface NormalizedExternalEvent {
  tenantId: string;
  provider: IntegrationProvider;
  integrationConnectionId: string;
  externalAccountId?: string;
  externalEventId: string;
  eventType: NormalizedExternalEventType;
  occurredAt: string;
  receivedAt: string;
  subject: ExternalSubject;
  payloadVersion: string;
  normalizedPayload: unknown;
  rawPayloadReference?: string;
  idempotencyKey: string;
  payloadHash: string;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Adapter contract (implemented by mock + server-only stub adapters)
// ---------------------------------------------------------------------------

export interface IntegrationContext {
  tenantId: string;
  integrationConnectionId: string;
  provider: IntegrationProvider;
  now: Date;
}

export interface ConnectionVerificationResult {
  ok: boolean;
  status: IntegrationStatus;
  detail: string;
}

export interface RawWebhookRequest {
  method: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
  receivedAt: string;
}

export interface WebhookVerificationRequest extends RawWebhookRequest {
  /** The signature the server already computed over the body (HMAC done server-side). */
  computedSignature?: string;
  providedSignature?: string;
  timestamp?: string;
}

export interface WebhookVerificationResult {
  ok: boolean;
  reason: WebhookRejectReason | 'verified';
}

export interface PullEventsResult {
  events: NormalizedExternalEvent[];
  nextCursor: string | null;
}

export interface HumanOutboundRequestInput {
  tenantId: string;
  conversationRef: string;
  channel: IntegrationProvider;
  body: string;
  templateId?: string;
  idempotencyKey: string;
}

export interface HumanOutboundResult {
  simulated: true;
  accepted: boolean;
  reason: string;
  /** Always null — Phase 7A never produces a real provider reference. */
  providerMessageRef: null;
}

export interface ExternalIntegrationAdapter {
  readonly provider: IntegrationProvider;
  readonly capabilities: IntegrationCapability[];
  verifyConnection(context: IntegrationContext): Promise<ConnectionVerificationResult>;
  verifyWebhook?(
    request: WebhookVerificationRequest,
    context: IntegrationContext,
  ): Promise<WebhookVerificationResult>;
  parseWebhook?(
    request: RawWebhookRequest,
    context: IntegrationContext,
  ): Promise<NormalizedExternalEvent[]>;
  pullEvents?(cursor: string | null, context: IntegrationContext): Promise<PullEventsResult>;
  sendHumanMessage?(
    request: HumanOutboundRequestInput,
    context: IntegrationContext,
  ): Promise<HumanOutboundResult>;
}

// ---------------------------------------------------------------------------
// Hashing + idempotency
// ---------------------------------------------------------------------------

export function payloadHash(rawBody: string): string {
  return fnv1aHex(rawBody);
}

export interface ExternalIdempotencyParts {
  tenantId: string;
  provider: IntegrationProvider;
  integrationConnectionId: string;
  externalEventId: string;
}

export function buildExternalIdempotencyKey(p: ExternalIdempotencyParts): string {
  return fnv1aHex([p.tenantId, p.provider, p.integrationConnectionId, p.externalEventId].join('|'));
}

/** Decide what to do when an event arrives with a known idempotency key. */
export type IdempotencyDecision = 'new' | 'duplicate_ignore' | 'conflict_reject';

export function decideIdempotency(
  existing: { idempotencyKey: string; payloadHash: string } | null,
  incoming: { idempotencyKey: string; payloadHash: string },
): IdempotencyDecision {
  if (!existing) return 'new';
  if (existing.payloadHash === incoming.payloadHash) return 'duplicate_ignore';
  // Same key, different payload → reject + flag.
  return 'conflict_reject';
}

// ---------------------------------------------------------------------------
// Webhook security (decision logic; HMAC is computed server-side)
// ---------------------------------------------------------------------------

export type WebhookRejectReason =
  | 'wrong_method'
  | 'missing_signature'
  | 'invalid_signature'
  | 'expired_timestamp'
  | 'oversized_payload'
  | 'wrong_content_type'
  | 'unknown_integration'
  | 'disabled_integration';

/** Constant-time string comparison (avoids signature timing leaks). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function withinReplayWindow(timestamp: string, now: Date, windowSeconds: number): boolean {
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return false;
  const ageSec = Math.abs(now.getTime() - t) / 1000;
  return ageSec <= windowSeconds;
}

export interface WebhookAcceptanceInput {
  method: string;
  allowedMethods: string[];
  contentType?: string;
  allowedContentTypes: string[];
  bodySize: number;
  maxBodySize: number;
  providedSignature?: string;
  computedSignature?: string;
  timestamp?: string;
  now: Date;
  replayWindowSeconds: number;
  integrationKnown: boolean;
  integrationDisabled: boolean;
  /** Whether this provider requires a signature (vs a verification-token challenge). */
  requiresSignature: boolean;
}

export interface WebhookAcceptance {
  accept: boolean;
  reason: WebhookRejectReason | 'verified';
}

/** Provider-independent webhook gate. Tenant/integration are resolved from the
 * configured endpoint — NEVER from the payload. */
export function decideWebhookAcceptance(input: WebhookAcceptanceInput): WebhookAcceptance {
  if (!input.integrationKnown) return { accept: false, reason: 'unknown_integration' };
  if (input.integrationDisabled) return { accept: false, reason: 'disabled_integration' };
  if (!input.allowedMethods.includes(input.method.toUpperCase()))
    return { accept: false, reason: 'wrong_method' };
  if (input.contentType && !input.allowedContentTypes.some((c) => input.contentType!.includes(c)))
    return { accept: false, reason: 'wrong_content_type' };
  if (input.bodySize > input.maxBodySize) return { accept: false, reason: 'oversized_payload' };
  if (input.requiresSignature) {
    if (!input.providedSignature || !input.computedSignature)
      return { accept: false, reason: 'missing_signature' };
    if (!constantTimeEqual(input.providedSignature, input.computedSignature))
      return { accept: false, reason: 'invalid_signature' };
  }
  if (input.timestamp && !withinReplayWindow(input.timestamp, input.now, input.replayWindowSeconds))
    return { accept: false, reason: 'expired_timestamp' };
  return { accept: true, reason: 'verified' };
}

// ---------------------------------------------------------------------------
// WhatsApp inbound normalization
// ---------------------------------------------------------------------------

export type WhatsAppInboundType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'template_response'
  | 'unsupported';

export interface WhatsAppRawMessage {
  type: string;
  text?: string;
  mediaId?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  checksum?: string;
}

export interface WhatsAppNormalizedMessage {
  type: WhatsAppInboundType;
  text?: string;
  media?: {
    providerReference: string;
    mimeType?: string;
    filename?: string;
    size?: number;
    checksum?: string;
    storageState: 'external_reference_only';
    scanState: 'not_scanned';
  };
  /** Unsupported content still produces a safe inbox event (never fails ingestion). */
  safe: boolean;
}

const WA_TYPES: Record<string, WhatsAppInboundType> = {
  text: 'text',
  image: 'image',
  document: 'document',
  audio: 'audio',
  video: 'video',
  location: 'location',
  contacts: 'contact',
  interactive: 'interactive',
  button: 'template_response',
};

export function normalizeWhatsAppMessage(raw: WhatsAppRawMessage): WhatsAppNormalizedMessage {
  const t = WA_TYPES[raw.type] ?? 'unsupported';
  if (t === 'text') return { type: 'text', text: raw.text ?? '', safe: true };
  if (t === 'unsupported') {
    return { type: 'unsupported', text: `[unsupported:${raw.type}]`, safe: true };
  }
  if (raw.mediaId) {
    return {
      type: t,
      media: {
        providerReference: raw.mediaId,
        mimeType: raw.mimeType,
        filename: raw.filename,
        size: raw.size,
        checksum: raw.checksum,
        storageState: 'external_reference_only',
        scanState: 'not_scanned',
      },
      safe: true,
    };
  }
  return { type: t, safe: true };
}

// ---------------------------------------------------------------------------
// WhatsApp conversation policy (synthetic in 7A)
// ---------------------------------------------------------------------------

export type WhatsAppPolicyState =
  | 'session_messaging_allowed'
  | 'approved_template_required'
  | 'messaging_blocked'
  | 'consent_blocked'
  | 'dnc_blocked'
  | 'provider_unavailable'
  | 'policy_unknown'
  | 'human_review_required';

export interface WhatsAppPolicyInput {
  lastCustomerInboundAt?: string;
  now: Date;
  sessionWindowHours: number;
  consentGranted: boolean;
  dncActive: boolean;
  optedOut: boolean;
  providerAvailable: boolean;
  policyKnown: boolean;
}

export function evaluateWhatsAppPolicy(input: WhatsAppPolicyInput): WhatsAppPolicyState {
  if (!input.policyKnown) return 'policy_unknown';
  if (!input.providerAvailable) return 'provider_unavailable';
  if (input.optedOut) return 'dnc_blocked';
  if (input.dncActive) return 'dnc_blocked';
  if (!input.consentGranted) return 'consent_blocked';
  if (input.lastCustomerInboundAt) {
    const ageH =
      (input.now.getTime() - new Date(input.lastCustomerInboundAt).getTime()) / 3_600_000;
    if (ageH <= input.sessionWindowHours) return 'session_messaging_allowed';
  }
  return 'approved_template_required';
}

// ---------------------------------------------------------------------------
// Delivery callback normalization
// ---------------------------------------------------------------------------

export type ProviderDeliveryStatus =
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled'
  | 'unknown';

const DELIVERY_ORDER: Record<ProviderDeliveryStatus, number> = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
  cancelled: 5,
  unknown: 0,
};

/** A later (lower-ordinal) callback must not regress a more advanced state,
 * except terminal failed/cancelled. Out-of-order/duplicate callbacks are no-ops. */
export function shouldApplyDeliveryCallback(
  current: ProviderDeliveryStatus,
  incoming: ProviderDeliveryStatus,
): boolean {
  if (incoming === 'unknown') return false;
  if (incoming === 'failed' || incoming === 'cancelled') return current !== incoming;
  return DELIVERY_ORDER[incoming] > DELIVERY_ORDER[current];
}

// ---------------------------------------------------------------------------
// Email normalization helpers
// ---------------------------------------------------------------------------

/** Remove quoted reply history (lines after a quote marker) to avoid storing it. */
export function stripQuotedHistory(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

export function isDangerousUrl(url: string): boolean {
  return /^(javascript|data|vbscript|file):/i.test(url.trim());
}

/** Redact common provider-token patterns from any text before storage/logging. */
export function redactSecrets(text: string): string {
  return text
    .replace(/EAA[A-Za-z0-9]{20,}/g, '[redacted_meta_token]')
    .replace(/ya29\.[A-Za-z0-9._-]{20,}/g, '[redacted_google_token]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[redacted_secret]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[redacted_google_key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]');
}

// ---------------------------------------------------------------------------
// Portal email lead parsers (synthetic fixtures only)
// ---------------------------------------------------------------------------

export interface ParsedPortalLead {
  ok: boolean;
  review: boolean;
  parserVersion: string;
  confidence: 'high' | 'medium' | 'low';
  fields: {
    name?: string;
    phone?: string;
    email?: string;
    project?: string;
    locality?: string;
    budget?: string;
    portalLeadId?: string;
    message?: string;
  };
  missingRequired: string[];
}

const PHONE_RE = /(\+?\d[\d\s-]{8,}\d)/;
const EMAIL_RE = /([\w.+-]+@[\w-]+\.[\w.-]+)/;

/** Deterministic key:value portal-email parser. Never invents fields; routes to
 * review when a required field (phone) is missing. */
export function parsePortalEmail(provider: IntegrationProvider, body: string): ParsedPortalLead {
  const fields: ParsedPortalLead['fields'] = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]+?)\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase().replace(/\s+/g, '');
    const val = m[2]!.trim();
    if (key.includes('name')) fields.name ??= val;
    else if (key.includes('phone') || key.includes('mobile')) fields.phone ??= val;
    else if (key.includes('email')) fields.email ??= val;
    else if (key.includes('project')) fields.project ??= val;
    else if (key.includes('locality') || key.includes('location')) fields.locality ??= val;
    else if (key.includes('budget')) fields.budget ??= val;
    else if (key.includes('leadid') || key.includes('enquiryid')) fields.portalLeadId ??= val;
    else if (key.includes('message') || key.includes('comment')) fields.message ??= val;
  }
  if (!fields.phone) {
    const m = body.match(PHONE_RE);
    if (m) fields.phone = m[1];
  }
  if (!fields.email) {
    const m = body.match(EMAIL_RE);
    if (m) fields.email = m[1];
  }
  const missingRequired: string[] = [];
  if (!fields.phone && !fields.email) missingRequired.push('contact');
  return {
    ok: missingRequired.length === 0,
    review: missingRequired.length > 0,
    parserVersion: `${provider}-v1`,
    confidence: fields.portalLeadId ? 'high' : fields.phone ? 'medium' : 'low',
    fields,
    missingRequired,
  };
}

// ---------------------------------------------------------------------------
// Connection health
// ---------------------------------------------------------------------------

export type HealthState =
  | 'healthy'
  | 'degraded'
  | 'failing'
  | 'expired'
  | 'revoked'
  | 'disabled'
  | 'unconfigured'
  | 'unknown';

export interface HealthInput {
  status: IntegrationStatus;
  configured: boolean;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  tokenExpiresAt?: string;
  subscriptionExpiresAt?: string;
  deadLetterCount: number;
  now: Date;
}

/** Health is never "healthy" merely because configuration exists. */
export function computeHealthState(input: HealthInput): HealthState {
  if (input.status === 'disabled') return 'disabled';
  if (input.status === 'revoked') return 'revoked';
  if (!input.configured || input.status === 'unconfigured' || input.status === 'draft')
    return 'unconfigured';
  const expired = (iso?: string) =>
    iso !== undefined && new Date(iso).getTime() <= input.now.getTime();
  if (expired(input.tokenExpiresAt) || expired(input.subscriptionExpiresAt)) return 'expired';
  if (input.consecutiveFailures >= 5 || input.deadLetterCount >= 10) return 'failing';
  if (input.consecutiveFailures >= 1 || input.deadLetterCount >= 1) return 'degraded';
  if (!input.lastSuccessAt) return 'unknown';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Replay decision
// ---------------------------------------------------------------------------

export type FailureClass = 'retryable' | 'permanent' | 'dead_letter';

export function classifyFailure(httpStatus: number | null, code: string | null): FailureClass {
  if (code === 'malformed_payload' || code === 'idempotency_conflict') return 'permanent';
  if (httpStatus === null) return 'retryable';
  if (httpStatus >= 500 || httpStatus === 429) return 'retryable';
  if (httpStatus >= 400) return 'permanent';
  return 'retryable';
}

export interface ReplayDecisionInput {
  hasPermission: boolean;
  reasonProvided: boolean;
  originalEventExists: boolean;
  alreadySucceeded: boolean;
}

export interface ReplayDecision {
  allow: boolean;
  reason: string;
}

/** Replay must not duplicate a successful side effect; the new attempt keeps the
 * same idempotency protection. */
export function decideReplay(input: ReplayDecisionInput): ReplayDecision {
  if (!input.hasPermission) return { allow: false, reason: 'permission_denied' };
  if (!input.reasonProvided) return { allow: false, reason: 'reason_required' };
  if (!input.originalEventExists) return { allow: false, reason: 'original_not_found' };
  if (input.alreadySucceeded) return { allow: false, reason: 'already_succeeded_idempotent' };
  return { allow: true, reason: 'replay_allowed' };
}

// ---------------------------------------------------------------------------
// Deterministic test adapters (mock / failure / timeout / duplicate / etc.)
// ---------------------------------------------------------------------------

function baseEvent(
  ctx: IntegrationContext,
  externalEventId: string,
  rawBody: string,
  over: Partial<NormalizedExternalEvent> = {},
): NormalizedExternalEvent {
  const hash = payloadHash(rawBody);
  return {
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    integrationConnectionId: ctx.integrationConnectionId,
    externalEventId,
    eventType: 'inbound_message',
    occurredAt: ctx.now.toISOString(),
    receivedAt: ctx.now.toISOString(),
    subject: {},
    payloadVersion: 'v1',
    normalizedPayload: { rawBody },
    idempotencyKey: buildExternalIdempotencyKey({
      tenantId: ctx.tenantId,
      provider: ctx.provider,
      integrationConnectionId: ctx.integrationConnectionId,
      externalEventId,
    }),
    payloadHash: hash,
    correlationId: externalEventId,
    ...over,
  };
}

export function createMockAdapter(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: ['lead_ingestion', 'inbound_messages', 'delivery_callbacks'],
    async verifyConnection() {
      // Phase 7A: a mock verification never reports a real "connected".
      return { ok: true, status: 'test', detail: 'mock_verified_test_mode' };
    },
    async verifyWebhook() {
      return { ok: true, reason: 'verified' };
    },
    async parseWebhook(req, ctx) {
      return [baseEvent(ctx, `evt-${payloadHash(req.rawBody)}`, req.rawBody)];
    },
    async sendHumanMessage() {
      return {
        simulated: true,
        accepted: true,
        reason: 'simulation_only',
        providerMessageRef: null,
      };
    },
  };
}

export function createFailureAdapter(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: ['inbound_messages'],
    async verifyConnection() {
      return { ok: false, status: 'error', detail: 'mock_failure' };
    },
    async parseWebhook() {
      throw new Error('mock_failure');
    },
  };
}

export function createMalformedAdapter(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: ['inbound_messages'],
    async verifyConnection() {
      return { ok: false, status: 'error', detail: 'malformed' };
    },
    async parseWebhook() {
      // Malformed payload → no events; the route classifies this as permanent.
      return [];
    },
  };
}

export function createDuplicateAdapter(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: ['inbound_messages'],
    async verifyConnection() {
      return { ok: true, status: 'test', detail: 'mock' };
    },
    async parseWebhook(req, ctx) {
      // Emits the SAME externalEventId twice → idempotency must dedupe.
      const e = baseEvent(ctx, 'dup-1', req.rawBody);
      return [e, { ...e }];
    },
  };
}

export function createOutOfOrderAdapter(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: ['delivery_callbacks'],
    async verifyConnection() {
      return { ok: true, status: 'test', detail: 'mock' };
    },
    async parseWebhook(req, ctx) {
      // delivered then sent (out of order) — the transition guard ignores the regress.
      return [
        baseEvent(ctx, 'd-2', req.rawBody, { eventType: 'message_delivered' }),
        baseEvent(ctx, 'd-1', req.rawBody, { eventType: 'message_sent' }),
      ];
    },
  };
}
