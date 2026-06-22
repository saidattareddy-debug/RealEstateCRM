import { describe, it, expect } from 'vitest';
import {
  payloadHash,
  buildExternalIdempotencyKey,
  decideIdempotency,
  constantTimeEqual,
  withinReplayWindow,
  decideWebhookAcceptance,
  normalizeWhatsAppMessage,
  evaluateWhatsAppPolicy,
  shouldApplyDeliveryCallback,
  stripQuotedHistory,
  isDangerousUrl,
  redactSecrets,
  parsePortalEmail,
  computeHealthState,
  classifyFailure,
  decideReplay,
  createMockAdapter,
  createDuplicateAdapter,
  PHASE_7A_ALLOWED_STATUSES,
  type WebhookAcceptanceInput,
  type IntegrationContext,
} from '../integrations';

const NOW = new Date('2026-06-20T12:00:00Z');

describe('idempotency & hashing', () => {
  it('payload hash is deterministic; idempotency key is stable', () => {
    expect(payloadHash('abc')).toBe(payloadHash('abc'));
    const parts = {
      tenantId: 't',
      provider: 'whatsapp_cloud' as const,
      integrationConnectionId: 'c',
      externalEventId: 'e1',
    };
    expect(buildExternalIdempotencyKey(parts)).toBe(buildExternalIdempotencyKey(parts));
    expect(buildExternalIdempotencyKey({ ...parts, externalEventId: 'e2' })).not.toBe(
      buildExternalIdempotencyKey(parts),
    );
  });
  it('same key + same hash → duplicate; same key + different hash → conflict', () => {
    expect(decideIdempotency(null, { idempotencyKey: 'k', payloadHash: 'h' })).toBe('new');
    expect(
      decideIdempotency(
        { idempotencyKey: 'k', payloadHash: 'h' },
        { idempotencyKey: 'k', payloadHash: 'h' },
      ),
    ).toBe('duplicate_ignore');
    expect(
      decideIdempotency(
        { idempotencyKey: 'k', payloadHash: 'h1' },
        { idempotencyKey: 'k', payloadHash: 'h2' },
      ),
    ).toBe('conflict_reject');
  });
});

describe('webhook security', () => {
  const base = (over: Partial<WebhookAcceptanceInput> = {}): WebhookAcceptanceInput => ({
    method: 'POST',
    allowedMethods: ['POST'],
    contentType: 'application/json',
    allowedContentTypes: ['application/json'],
    bodySize: 100,
    maxBodySize: 1000,
    providedSignature: 'sig',
    computedSignature: 'sig',
    timestamp: NOW.toISOString(),
    now: NOW,
    replayWindowSeconds: 300,
    integrationKnown: true,
    integrationDisabled: false,
    requiresSignature: true,
    ...over,
  });

  it('accepts a valid signed request', () => {
    expect(decideWebhookAcceptance(base())).toEqual({ accept: true, reason: 'verified' });
  });
  it('rejects each failure mode', () => {
    expect(decideWebhookAcceptance(base({ integrationKnown: false })).reason).toBe(
      'unknown_integration',
    );
    expect(decideWebhookAcceptance(base({ integrationDisabled: true })).reason).toBe(
      'disabled_integration',
    );
    expect(decideWebhookAcceptance(base({ method: 'GET' })).reason).toBe('wrong_method');
    expect(decideWebhookAcceptance(base({ contentType: 'text/xml' })).reason).toBe(
      'wrong_content_type',
    );
    expect(decideWebhookAcceptance(base({ bodySize: 5000 })).reason).toBe('oversized_payload');
    expect(decideWebhookAcceptance(base({ providedSignature: undefined })).reason).toBe(
      'missing_signature',
    );
    expect(decideWebhookAcceptance(base({ providedSignature: 'other' })).reason).toBe(
      'invalid_signature',
    );
    expect(decideWebhookAcceptance(base({ timestamp: '2020-01-01T00:00:00Z' })).reason).toBe(
      'expired_timestamp',
    );
  });
  it('constant-time compare + replay window', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(withinReplayWindow(NOW.toISOString(), NOW, 300)).toBe(true);
    expect(withinReplayWindow('2020-01-01T00:00:00Z', NOW, 300)).toBe(false);
  });
});

describe('WhatsApp normalization + policy', () => {
  it('text + media + unsupported normalize safely', () => {
    expect(normalizeWhatsAppMessage({ type: 'text', text: 'hi' })).toMatchObject({
      type: 'text',
      text: 'hi',
      safe: true,
    });
    const img = normalizeWhatsAppMessage({ type: 'image', mediaId: 'm1', mimeType: 'image/jpeg' });
    expect(img.type).toBe('image');
    expect(img.media?.storageState).toBe('external_reference_only');
    expect(img.media?.scanState).toBe('not_scanned');
    const un = normalizeWhatsAppMessage({ type: 'sticker' });
    expect(un.type).toBe('unsupported');
    expect(un.safe).toBe(true);
  });
  it('policy: session vs template vs blocks', () => {
    const base = {
      now: NOW,
      sessionWindowHours: 24,
      consentGranted: true,
      dncActive: false,
      optedOut: false,
      providerAvailable: true,
      policyKnown: true,
    };
    expect(evaluateWhatsAppPolicy({ ...base, lastCustomerInboundAt: '2026-06-20T06:00:00Z' })).toBe(
      'session_messaging_allowed',
    );
    expect(evaluateWhatsAppPolicy({ ...base, lastCustomerInboundAt: '2026-06-18T06:00:00Z' })).toBe(
      'approved_template_required',
    );
    expect(evaluateWhatsAppPolicy({ ...base, consentGranted: false })).toBe('consent_blocked');
    expect(evaluateWhatsAppPolicy({ ...base, dncActive: true })).toBe('dnc_blocked');
    expect(evaluateWhatsAppPolicy({ ...base, providerAvailable: false })).toBe(
      'provider_unavailable',
    );
    expect(evaluateWhatsAppPolicy({ ...base, policyKnown: false })).toBe('policy_unknown');
  });
});

describe('delivery callback transitions', () => {
  it('advances forward, ignores regress + duplicates, allows terminal failure', () => {
    expect(shouldApplyDeliveryCallback('sent', 'delivered')).toBe(true);
    expect(shouldApplyDeliveryCallback('delivered', 'sent')).toBe(false);
    expect(shouldApplyDeliveryCallback('delivered', 'delivered')).toBe(false);
    expect(shouldApplyDeliveryCallback('delivered', 'failed')).toBe(true);
    expect(shouldApplyDeliveryCallback('read', 'unknown')).toBe(false);
  });
});

describe('email helpers', () => {
  it('strips quoted history', () => {
    expect(stripQuotedHistory('Hello\n> old reply\n> more')).toBe('Hello');
    expect(stripQuotedHistory('Hi there\nOn Mon someone wrote:\nquoted')).toBe('Hi there');
  });
  it('flags dangerous URLs', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('https://example.com')).toBe(false);
  });
  it('redacts provider tokens', () => {
    expect(redactSecrets('token EAA' + 'x'.repeat(30))).toContain('[redacted_meta_token]');
    expect(redactSecrets('Bearer abcdef123456')).toContain('Bearer [redacted]');
  });
});

describe('portal parsers', () => {
  it('parses a well-formed portal email', () => {
    const r = parsePortalEmail(
      'nobroker',
      'Name: Asha\nPhone: +91 98000 11111\nProject: Skyline\nLeadId: NB123',
    );
    expect(r.ok).toBe(true);
    expect(r.fields.phone).toContain('98000');
    expect(r.fields.portalLeadId).toBe('NB123');
    expect(r.confidence).toBe('high');
  });
  it('routes to review when no contact is present (never invents)', () => {
    const r = parsePortalEmail('housing', 'Project: Skyline\nMessage: interested');
    expect(r.ok).toBe(false);
    expect(r.review).toBe(true);
    expect(r.missingRequired).toContain('contact');
  });
});

describe('health + failure + replay', () => {
  it('health is never healthy on config alone', () => {
    const base = {
      configured: true,
      consecutiveFailures: 0,
      deadLetterCount: 0,
      now: NOW,
    } as const;
    expect(computeHealthState({ ...base, status: 'test', lastSuccessAt: undefined })).toBe(
      'unknown',
    );
    expect(computeHealthState({ ...base, status: 'test', lastSuccessAt: NOW.toISOString() })).toBe(
      'healthy',
    );
    expect(computeHealthState({ ...base, status: 'unconfigured' })).toBe('unconfigured');
    expect(computeHealthState({ ...base, status: 'disabled' })).toBe('disabled');
    expect(computeHealthState({ ...base, status: 'test', consecutiveFailures: 6 })).toBe('failing');
    expect(
      computeHealthState({ ...base, status: 'test', tokenExpiresAt: '2020-01-01T00:00:00Z' }),
    ).toBe('expired');
  });
  it('classifies failures', () => {
    expect(classifyFailure(500, null)).toBe('retryable');
    expect(classifyFailure(429, null)).toBe('retryable');
    expect(classifyFailure(400, null)).toBe('permanent');
    expect(classifyFailure(null, 'malformed_payload')).toBe('permanent');
  });
  it('replay refuses without permission/reason/event and when already succeeded', () => {
    expect(
      decideReplay({
        hasPermission: false,
        reasonProvided: true,
        originalEventExists: true,
        alreadySucceeded: false,
      }).allow,
    ).toBe(false);
    expect(
      decideReplay({
        hasPermission: true,
        reasonProvided: false,
        originalEventExists: true,
        alreadySucceeded: false,
      }).reason,
    ).toBe('reason_required');
    expect(
      decideReplay({
        hasPermission: true,
        reasonProvided: true,
        originalEventExists: true,
        alreadySucceeded: true,
      }).reason,
    ).toBe('already_succeeded_idempotent');
    expect(
      decideReplay({
        hasPermission: true,
        reasonProvided: true,
        originalEventExists: true,
        alreadySucceeded: false,
      }).allow,
    ).toBe(true);
  });
});

describe('adapters (mock/simulation only)', () => {
  const ctx: IntegrationContext = {
    tenantId: 't',
    integrationConnectionId: 'c',
    provider: 'whatsapp_cloud',
    now: NOW,
  };
  it('mock verification never reports a real connected status in 7A', async () => {
    const r = await createMockAdapter('whatsapp_cloud').verifyConnection(ctx);
    expect(PHASE_7A_ALLOWED_STATUSES).toContain(r.status);
    expect(r.status).not.toBe('connected');
  });
  it('human send is simulation-only with no provider reference', async () => {
    const r = await createMockAdapter('whatsapp_cloud').sendHumanMessage!(
      {
        tenantId: 't',
        conversationRef: 'cv',
        channel: 'whatsapp_cloud',
        body: 'hi',
        idempotencyKey: 'k',
      },
      ctx,
    );
    expect(r.simulated).toBe(true);
    expect(r.providerMessageRef).toBeNull();
  });
  it('duplicate adapter emits same idempotency key twice (dedupe is the consumer’s job)', async () => {
    const evs = await createDuplicateAdapter('whatsapp_cloud').parseWebhook!(
      { method: 'POST', headers: {}, rawBody: '{}', receivedAt: NOW.toISOString() },
      ctx,
    );
    expect(evs).toHaveLength(2);
    expect(evs[0]!.idempotencyKey).toBe(evs[1]!.idempotencyKey);
  });
});
