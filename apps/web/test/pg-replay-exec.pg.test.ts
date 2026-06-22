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
// Dynamic adapter — emits a normalized event built from the request body so each
// webhook call can drive a specific delivery-callback kind + provider reference.
vi.mock('@/lib/integrations/registry', () => ({
  resolveAdapter: () => ({
    parseWebhook: (raw: { rawBody: string }) => {
      const b = JSON.parse(raw.rawBody) as {
        kind: string;
        ref?: string;
        idem: string;
        eid: string;
      };
      return Promise.resolve([
        {
          provider: 'whatsapp_cloud',
          eventType: b.kind,
          externalEventId: b.eid,
          occurredAt: '2026-06-20T12:00:00Z',
          receivedAt: '2026-06-20T12:00:00Z',
          payloadVersion: '1',
          normalizedPayload: { providerMessageId: b.ref ?? null, status: b.kind },
          payloadHash: b.idem,
          idempotencyKey: b.idem,
          correlationId: 'cb',
          subject: {},
        } as unknown as NormalizedExternalEvent,
      ]);
    },
  }),
}));

import { executeReplay } from '@/lib/integrations/replay';
import { ingestWebhook } from '@/lib/integrations/ingest';

const AGENT = '00000000-0000-0000-0000-0000000000a2';
let booted: BootedPg;
let pool: Pool;
let connId = '';

const cnt = async (sql: string, p: unknown[]): Promise<number> =>
  Number((await pool.query(sql, p)).rows[0].c);

// Seed a normalized lead event (post-normalization) with a chosen status.
async function mkLeadEvent(status: string, key: string, envelopeStatus?: string): Promise<string> {
  let envId: string | null = null;
  if (envelopeStatus) {
    envId = (
      await pool.query(
        `insert into external_event_envelopes(tenant_id, integration_connection_id, provider, body_hash, receipt_idempotency_key, processing_status)
         values ($1,$2,'manual_test','bh',$3,$4) returning id`,
        [SEED_TENANT_A, connId, `rcpt-${key}`, envelopeStatus],
      )
    ).rows[0].id as string;
  }
  return (
    await pool.query(
      `insert into external_events(tenant_id, provider, connection_id, envelope_id, external_event_id, event_type, normalized_payload, payload_hash, idempotency_key, status)
       values ($1,'manual_test',$2,$3,$4,'lead_created',$5,'ph',$6,$7) returning id`,
      [
        SEED_TENANT_A,
        connId,
        envId,
        key,
        JSON.stringify({ name: 'Replay Lead', phone: '+919811100000' }),
        key,
        status,
      ],
    )
  ).rows[0].id as string;
}

beforeAll(async () => {
  booted = await bootEmbeddedPg({ port: 5461, dir: '/tmp/pgtest/pgrx' });
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

describe('executeReplay — local post-normalization replay against EMBEDDED PostgreSQL', () => {
  it('successful replay after a lead-processing failure creates the missed lead', async () => {
    const before = await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A]);
    const id = await mkLeadEvent('failed', 'rx-fail-1');
    const res = await executeReplay({
      tenantId: SEED_TENANT_A,
      actorUserId: AGENT,
      hasPermission: true,
      eventId: id,
      reason: 'reprocess after fix',
      adapterVersion: 'wa-v2',
      mappingVersion: 'map-v3',
    });
    expect(res.ok).toBe(true);
    expect(res.executed).toBe(true);
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      before + 1,
    );
    // The replay row records the selected adapter + mapping version.
    const rp = (
      await pool.query(
        `select adapter_version, mapping_version, state from external_event_replays where event_id=$1`,
        [id],
      )
    ).rows[0];
    expect(rp.adapter_version).toBe('wa-v2');
    expect(rp.mapping_version).toBe('map-v3');
    expect(rp.state).toBe('executed');
  });

  it('replay after success creates NO duplicate side effects (idempotent), and a concurrent replay is also safe', async () => {
    const id = await mkLeadEvent('failed', 'rx-idem-1');
    await executeReplay({
      tenantId: SEED_TENANT_A,
      actorUserId: AGENT,
      hasPermission: true,
      eventId: id,
      reason: 'first',
    });
    const afterFirst = await cnt(`select count(*) c from leads where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    // Replay again + a concurrent pair — all share the original idempotency anchor.
    await Promise.all([
      executeReplay({
        tenantId: SEED_TENANT_A,
        actorUserId: AGENT,
        hasPermission: true,
        eventId: id,
        reason: 'again',
      }),
      executeReplay({
        tenantId: SEED_TENANT_A,
        actorUserId: AGENT,
        hasPermission: true,
        eventId: id,
        reason: 'again2',
      }),
    ]);
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      afterFirst,
    );
  });

  it('parse failures (resubmission_required envelope) cannot be replayed', async () => {
    const id = await mkLeadEvent('failed', 'rx-resub', 'resubmission_required');
    const res = await executeReplay({
      tenantId: SEED_TENANT_A,
      actorUserId: AGENT,
      hasPermission: true,
      eventId: id,
      reason: 'x',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('parse_failure_not_replayable');
  });

  it('replay is denied without permission, without reason, and cross-tenant', async () => {
    const id = await mkLeadEvent('failed', 'rx-deny');
    expect(
      (
        await executeReplay({
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
        await executeReplay({
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
        await executeReplay({
          tenantId: SEED_TENANT_B,
          actorUserId: AGENT,
          hasPermission: true,
          eventId: id,
          reason: 'x',
        })
      ).ok,
    ).toBe(false);
  });
});

describe('delivery-callback lifecycle against EMBEDDED PostgreSQL', () => {
  let convId = '';
  let msgId = '';
  const PROVIDER_REF = 'wamid.LC';

  const fire = (kind: string, ref: string | null, idem: string, eid: string) =>
    ingestWebhook({
      endpoint: {
        connectionId: connId,
        tenantId: SEED_TENANT_A,
        provider: 'whatsapp_cloud',
        status: 'active',
        disabled: false,
        endpointActive: true,
        requiresSignature: true,
        secretRef: 'WA',
        verificationTokenRef: null,
      } as never,
      raw: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        rawBody: JSON.stringify({ kind, ref, idem, eid }),
        receivedAt: new Date().toISOString(),
      },
      providedSignature: 'sig',
      timestamp: new Date().toISOString(),
      correlationId: 'cb',
    });

  beforeAll(async () => {
    // Seed an OUTBOUND message + an initial delivery row (status queued) with a
    // provider reference that callbacks will advance.
    const lead = (
      await pool.query(`insert into leads(tenant_id) values ($1) returning id`, [SEED_TENANT_A])
    ).rows[0].id;
    convId = (
      await pool.query(
        `insert into conversations(tenant_id, lead_id, channel, status) values ($1,$2,'whatsapp','open') returning id`,
        [SEED_TENANT_A, lead],
      )
    ).rows[0].id;
    msgId = (
      await pool.query(
        `insert into conversation_messages(tenant_id, conversation_id, lead_id, direction, sender, body, status)
         values ($1,$2,$3,'outbound','agent','hi','queued') returning id`,
        [SEED_TENANT_A, convId, lead],
      )
    ).rows[0].id;
    await pool.query(
      `insert into message_delivery_events(tenant_id, message_id, conversation_id, status, provider_ref)
       values ($1,$2,$3,'queued',$4)`,
      [SEED_TENANT_A, msgId, convId, PROVIDER_REF],
    );
  });

  const latestStatus = async () =>
    (
      await pool.query(
        `select status from message_delivery_events where provider_ref=$1 order by created_at desc limit 1`,
        [PROVIDER_REF],
      )
    ).rows[0].status;

  it('forward transitions advance the delivery lifecycle (queued → sent → delivered → read)', async () => {
    await fire('message_sent', PROVIDER_REF, 'cb-sent', 'cb-e-sent');
    expect(await latestStatus()).toBe('sent');
    await fire('message_delivered', PROVIDER_REF, 'cb-deliv', 'cb-e-deliv');
    expect(await latestStatus()).toBe('delivered');
    await fire('message_read', PROVIDER_REF, 'cb-read', 'cb-e-read');
    expect(await latestStatus()).toBe('read');
    // No customer message or conversation was created by callbacks.
    expect(
      await cnt(`select count(*) c from conversation_messages where conversation_id=$1`, [convId]),
    ).toBe(1);
  });

  it('an illegal backward transition is a no-op (read stays read)', async () => {
    await fire('message_sent', PROVIDER_REF, 'cb-back', 'cb-e-back');
    expect(await latestStatus()).toBe('read');
  });

  it('a duplicate callback (same idempotency key) adds no second delivery row', async () => {
    const before = await cnt(
      `select count(*) c from message_delivery_events where provider_ref=$1`,
      [PROVIDER_REF],
    );
    await fire('message_read', PROVIDER_REF, 'cb-read', 'cb-e-read'); // same idem+eid as before → event-level dedupe
    expect(
      await cnt(`select count(*) c from message_delivery_events where provider_ref=$1`, [
        PROVIDER_REF,
      ]),
    ).toBe(before);
  });

  it('an unknown provider reference creates no delivery row (review state), no message', async () => {
    const before = await cnt(`select count(*) c from message_delivery_events`, []);
    const out = await fire('message_delivered', 'wamid.UNKNOWN', 'cb-unk', 'cb-e-unk');
    expect(out.ok).toBe(true);
    expect(await cnt(`select count(*) c from message_delivery_events`, [])).toBe(before);
    expect(
      await cnt(
        `select count(*) c from whatsapp_provider_events where provider_message_ref='wamid.UNKNOWN'`,
        [],
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});
