import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import type { NormalizedExternalEvent } from '@re/domain';
import { bootEmbeddedPg, SEED_TENANT_A, SEED_TENANT_B, type BootedPg } from './pg-embedded';
import { makePgSupabase } from './pg-supabase';

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => h.client }));
vi.mock('@/lib/audit/request-context', () => ({
  getRequestContext: () =>
    Promise.resolve({ ip: null, userAgent: null, requestId: 'test', correlationId: 'test' }),
}));
vi.mock('@/lib/integrations/secrets', () => ({
  computeWebhookSignature: () => 'sig',
  secretRefConfigured: () => true,
}));
// Adapter that emits a delivery callback (message_delivered).
vi.mock('@/lib/integrations/registry', () => ({
  resolveAdapter: () => ({
    parseWebhook: () =>
      Promise.resolve([
        {
          provider: 'whatsapp_cloud',
          eventType: 'message_delivered',
          externalEventId: 'cb-1',
          occurredAt: '2026-06-20T12:00:00Z',
          receivedAt: '2026-06-20T12:00:00Z',
          payloadVersion: '1',
          normalizedPayload: { providerMessageId: 'wamid.X', status: 'delivered' },
          payloadHash: 'cbh',
          idempotencyKey: 'cb-idem-1',
          correlationId: 'cb-corr',
          subject: {},
        } as unknown as NormalizedExternalEvent,
      ]),
  }),
}));

import { requestReplay, deadLetterEvent } from '@/lib/integrations/replay';
import { ingestWebhook } from '@/lib/integrations/ingest';

const AGENT = '00000000-0000-0000-0000-0000000000a2';
let booted: BootedPg;
let pool: Pool;
let connId = '';

const cnt = async (sql: string, params: unknown[]): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].c);

async function mkEvent(status: string, idem: string): Promise<string> {
  return (
    await pool.query(
      `insert into external_events(tenant_id, provider, external_event_id, event_type, payload_hash, idempotency_key, status)
       values ($1,'manual_test',$2,'lead_created','ph',$3,$4) returning id`,
      [SEED_TENANT_A, idem, idem, status],
    )
  ).rows[0].id as string;
}

beforeAll(async () => {
  booted = await bootEmbeddedPg({ port: 5460, dir: '/tmp/pgtest/pgrc' });
  pool = booted.pool;
  h.client = makePgSupabase(pool);
  connId = (
    await pool.query(
      `select id from integration_connections where tenant_id=$1 and provider='manual_test' limit 1`,
      [SEED_TENANT_A],
    )
  ).rows[0].id as string;
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
});

describe('dead-letter + replay against EMBEDDED PostgreSQL (real service)', () => {
  it('deadLetterEvent marks the event and records a dead-letter row', async () => {
    const id = await mkEvent('failed', 'dl-1');
    const ok = await deadLetterEvent(h.client as never, SEED_TENANT_A, id, 'permanent failure');
    expect(ok).toBe(true);
    expect(
      (await pool.query(`select status from external_events where id=$1`, [id])).rows[0].status,
    ).toBe('dead_letter');
    expect(
      await cnt(`select count(*) c from external_event_dead_letters where event_id=$1`, [id]),
    ).toBe(1);
  });

  it('requestReplay (permission + reason, not yet succeeded) records ONE replay row, no side effects', async () => {
    const id = await mkEvent('dead_letter', 'rp-1');
    const leadsBefore = await cnt(`select count(*) c from leads where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const res = await requestReplay({
      tenantId: SEED_TENANT_A,
      actorUserId: AGENT,
      hasPermission: true,
      eventId: id,
      reason: 'reprocess after fix',
    });
    expect(res.ok).toBe(true);
    expect(res.replayId).toBeTruthy();
    expect(await cnt(`select count(*) c from external_event_replays where event_id=$1`, [id])).toBe(
      1,
    );
    // Replay records intent only — it does NOT re-run side effects inline.
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      leadsBefore,
    );
  });

  it('replay is denied without permission / without reason / for unknown / for already-succeeded events', async () => {
    const id = await mkEvent('dead_letter', 'rp-deny');
    expect(
      (
        await requestReplay({
          tenantId: SEED_TENANT_A,
          actorUserId: AGENT,
          hasPermission: false,
          eventId: id,
          reason: 'x',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await requestReplay({
          tenantId: SEED_TENANT_A,
          actorUserId: AGENT,
          hasPermission: true,
          eventId: id,
          reason: '  ',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await requestReplay({
          tenantId: SEED_TENANT_A,
          actorUserId: AGENT,
          hasPermission: true,
          eventId: '00000000-0000-0000-0000-0000000000ff',
          reason: 'x',
        })
      ).ok,
    ).toBe(false);
    const done = await mkEvent('processed', 'rp-done');
    expect(
      (
        await requestReplay({
          tenantId: SEED_TENANT_A,
          actorUserId: AGENT,
          hasPermission: true,
          eventId: done,
          reason: 'x',
        })
      ).ok,
    ).toBe(false);
  });

  it('cross-tenant replay is denied (event not visible under the other tenant)', async () => {
    const id = await mkEvent('dead_letter', 'rp-xt');
    const res = await requestReplay({
      tenantId: SEED_TENANT_B, // wrong tenant
      actorUserId: AGENT,
      hasPermission: true,
      eventId: id,
      reason: 'x',
    });
    expect(res.ok).toBe(false); // originalEventExists is false under tenant B
  });
});

describe('delivery callback routing against EMBEDDED PostgreSQL (record-only)', () => {
  const endpoint = () => ({
    connectionId: connId,
    tenantId: SEED_TENANT_A,
    provider: 'whatsapp_cloud' as const,
    status: 'active',
    disabled: false,
    endpointActive: true,
    requiresSignature: true,
    secretRef: 'WA',
    verificationTokenRef: null,
  });
  const NOW = new Date('2026-06-20T12:00:00Z');
  const call = (body: string) =>
    ingestWebhook({
      endpoint: endpoint() as never,
      raw: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        rawBody: body,
        receivedAt: NOW.toISOString(),
      },
      providedSignature: 'sig',
      timestamp: NOW.toISOString(),
      correlationId: 'cb',
      now: NOW,
    });

  it('a delivery callback is recorded as a provider event only — never a customer message', async () => {
    const out = await call('{"cb":1}');
    expect(out.ok).toBe(true);
    expect(
      await cnt(
        `select count(*) c from whatsapp_provider_events where kind='message_delivered'`,
        [],
      ),
    ).toBeGreaterThanOrEqual(1);
    // Callback alone never creates a conversation message.
    expect(
      await cnt(
        `select count(*) c from conversation_messages where external_message_id='cb-1'`,
        [],
      ),
    ).toBe(0);
  });

  it('a duplicate callback receipt is an idempotent no-op (no second provider event)', async () => {
    const before = await cnt(`select count(*) c from whatsapp_provider_events`, []);
    const out = await call('{"cb":1}'); // same body+timestamp → same receipt key
    expect(out.status).toBe('duplicate');
    expect(await cnt(`select count(*) c from whatsapp_provider_events`, [])).toBe(before);
  });
});
