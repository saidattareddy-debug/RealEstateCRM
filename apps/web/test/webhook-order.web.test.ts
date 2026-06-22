import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedExternalEvent } from '@re/domain';
import { makeFakeAdmin, rowCount, type FakeDb } from './fake-supabase';

// Shared fake DB + observations the test adapter records.
const state: { db: FakeDb } = { db: { tables: {} } };
const observed: { envelopesAtParse: number; eventsAtParse: number; attemptsAtParse: number } = {
  envelopesAtParse: -1,
  eventsAtParse: -1,
  attemptsAtParse: -1,
};
let parseShouldThrow = false;
const ingestLeadCalls: unknown[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => makeFakeAdmin(state.db).client,
}));
vi.mock('@/lib/audit/audit-service', () => ({ writeAudit: () => Promise.resolve() }));
vi.mock('@/lib/integrations/health', () => ({
  recomputeConnectionHealth: () => Promise.resolve(),
}));
vi.mock('@/lib/integrations/secrets', () => ({
  computeWebhookSignature: () => 'sig',
  secretRefConfigured: () => true,
}));
vi.mock('@/lib/leads/ingest', () => ({
  ingestLead: (...a: unknown[]) => {
    ingestLeadCalls.push(a);
    return Promise.resolve({ leadId: 'lead_1' });
  },
}));
vi.mock('@/lib/conversations/ingest-message', () => ({
  ingestConversationMessage: () => Promise.resolve({ ok: true, duplicate: false, messageId: 'm1' }),
}));

// The test adapter observes DB state AT PARSE TIME — proving the authenticated
// receipt (envelope) is already durable before any parsing/normalization.
const ev: NormalizedExternalEvent = {
  provider: 'whatsapp_cloud',
  eventType: 'lead_created',
  externalEventId: 'evt_1',
  externalAccountId: null,
  occurredAt: '2026-06-20T12:00:00Z',
  receivedAt: '2026-06-20T12:00:00Z',
  payloadVersion: '1',
  normalizedPayload: { name: 'Asha', phone: '+919800011111', email: null },
  payloadHash: 'ph_1',
  idempotencyKey: 'idem_1',
  correlationId: 'corr_1',
  subject: { leadRef: 'Asha', contactPhone: '+919800011111', contactEmail: null },
} as unknown as NormalizedExternalEvent;

vi.mock('@/lib/integrations/registry', () => ({
  resolveAdapter: () => ({
    parseWebhook: () => {
      observed.envelopesAtParse = rowCount(state.db, 'external_event_envelopes');
      observed.eventsAtParse = rowCount(state.db, 'external_events');
      observed.attemptsAtParse = rowCount(state.db, 'external_event_attempts');
      if (parseShouldThrow) throw new Error('boom');
      return Promise.resolve([ev]);
    },
  }),
}));

import { ingestWebhook } from '@/lib/integrations/ingest';

const NOW = new Date('2026-06-20T12:00:00Z');
const endpoint = {
  connectionId: 'conn_1',
  tenantId: 't1',
  provider: 'whatsapp_cloud' as const,
  status: 'active',
  disabled: false,
  endpointActive: true,
  requiresSignature: true,
  secretRef: 'WA_SECRET',
  verificationTokenRef: null,
};
const call = () =>
  ingestWebhook({
    endpoint,
    raw: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      rawBody: '{"x":1}',
      receivedAt: NOW.toISOString(),
    },
    providedSignature: 'sig',
    timestamp: NOW.toISOString(),
    correlationId: 'corr_1',
    now: NOW,
  });

beforeEach(() => {
  state.db = { tables: {} };
  observed.envelopesAtParse = -1;
  observed.eventsAtParse = -1;
  observed.attemptsAtParse = -1;
  parseShouldThrow = false;
  ingestLeadCalls.length = 0;
});

describe('ingestWebhook — receipt-before-parse order', () => {
  it('persists the authenticated envelope BEFORE the adapter parses, then the event', async () => {
    const out = await call();
    expect(out.ok).toBe(true);
    expect(out.status).toBe('processed');
    // At parse time: envelope already durable; no event/attempt yet.
    expect(observed.envelopesAtParse).toBe(1);
    expect(observed.eventsAtParse).toBe(0);
    expect(observed.attemptsAtParse).toBe(0);
    // After processing: one event; a processing→processed attempt sequence; lead routed once.
    expect(rowCount(state.db, 'external_events')).toBe(1);
    const attempts = state.db.tables.external_event_attempts ?? [];
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.status)).toEqual(['processing', 'processed']);
    expect(ingestLeadCalls).toHaveLength(1);
    const envelope = (state.db.tables.external_event_envelopes ?? [])[0];
    expect(envelope?.processing_status).toBe('processed');
  });

  it('a parsing failure still leaves a durable authenticated receipt (resubmission_required)', async () => {
    parseShouldThrow = true;
    const out = await call();
    expect(out.ok).toBe(false);
    expect(observed.envelopesAtParse).toBe(1); // receipt existed at parse time
    const envelope = (state.db.tables.external_event_envelopes ?? [])[0];
    expect(envelope?.processing_status).toBe('resubmission_required');
    expect(envelope?.failure_category).toBe('parse_failure');
    expect(envelope?.body_hash).toBeTruthy(); // hash retained
    expect(rowCount(state.db, 'external_events')).toBe(0); // no normalized event
  });

  it('a duplicate authenticated receipt is an idempotent no-op (one envelope only)', async () => {
    await call();
    const out2 = await call(); // same body + timestamp → same receipt_idempotency_key
    expect(out2.status).toBe('duplicate');
    expect(rowCount(state.db, 'external_event_envelopes')).toBe(1);
  });
});
