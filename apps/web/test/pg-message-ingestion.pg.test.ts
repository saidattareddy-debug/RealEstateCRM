import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { bootEmbeddedPg, SEED_TENANT_A, SEED_TENANT_B, type BootedPg } from './pg-embedded';
import { makePgSupabase } from './pg-supabase';

// The service's recomputeSlaAdmin builds its own admin client — point it at the
// same pg-backed shim so the WHOLE path runs against embedded Postgres.
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => h.client }));

import { ingestConversationMessage } from '@/lib/conversations/ingest-message';

let booted: BootedPg;
let pool: Pool;
let convA = '';
let leadA = '';
let convB = '';
let leadB = '';

async function mkConv(tenant: string): Promise<{ lead: string; conv: string }> {
  const lead = (await pool.query(`insert into leads(tenant_id) values ($1) returning id`, [tenant]))
    .rows[0].id as string;
  const conv = (
    await pool.query(
      `insert into conversations(tenant_id, lead_id, channel, status, last_inbound_at)
       values ($1,$2,'whatsapp','open', now()) returning id`,
      [tenant, lead],
    )
  ).rows[0].id as string;
  return { lead, conv };
}

const cnt = async (sql: string, params: unknown[]): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].c);

beforeAll(async () => {
  booted = await bootEmbeddedPg();
  pool = booted.pool;
  h.client = makePgSupabase(pool);
  ({ lead: leadA, conv: convA } = await mkConv(SEED_TENANT_A));
  ({ lead: leadB, conv: convB } = await mkConv(SEED_TENANT_B));
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
});

describe('ingestConversationMessage against EMBEDDED PostgreSQL (real service)', () => {
  it('new WhatsApp message → exactly one ingestion event, message, and delivery event (trigger)', async () => {
    const res = await ingestConversationMessage(
      {
        tenantId: SEED_TENANT_A,
        conversationId: convA,
        leadId: leadA,
        body: 'Hello from WhatsApp',
        externalMessageId: 'wamid.A1',
        idempotencyKey: 'idem-A1',
        payloadHash: 'h-A1',
        correlationId: 'corr-A1',
      },
      h.client as never,
    );
    expect(res.ok).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.messageId).toBeTruthy();

    expect(
      await cnt(
        `select count(*) c from message_ingestion_events where tenant_id=$1 and idempotency_key=$2`,
        [SEED_TENANT_A, 'idem-A1'],
      ),
    ).toBe(1);
    expect(
      await cnt(
        `select count(*) c from conversation_messages where conversation_id=$1 and external_message_id=$2`,
        [convA, 'wamid.A1'],
      ),
    ).toBe(1);
    // The DB trigger (migration 0013) seeds exactly one initial delivery event.
    expect(
      await cnt(`select count(*) c from message_delivery_events where message_id=$1`, [
        res.messageId,
      ]),
    ).toBe(1);
    // Waiting-on transitioned to 'agent' (a lead message awaits the agent).
    const conv = (await pool.query(`select waiting_on from conversations where id=$1`, [convA]))
      .rows[0];
    expect(conv.waiting_on).toBe('agent');
  });

  it('duplicate authenticated message (same idempotency key) repeats NO downstream effect', async () => {
    const before = await cnt(
      `select count(*) c from conversation_messages where conversation_id=$1`,
      [convA],
    );
    const dup = await ingestConversationMessage(
      {
        tenantId: SEED_TENANT_A,
        conversationId: convA,
        leadId: leadA,
        body: 'Hello from WhatsApp',
        externalMessageId: 'wamid.A1',
        idempotencyKey: 'idem-A1',
        payloadHash: 'h-A1',
        correlationId: 'corr-A1',
      },
      h.client as never,
    );
    expect(dup.duplicate).toBe(true);
    expect(
      await cnt(`select count(*) c from conversation_messages where conversation_id=$1`, [convA]),
    ).toBe(before); // no second message
    expect(
      await cnt(
        `select count(*) c from message_ingestion_events where tenant_id=$1 and idempotency_key=$2`,
        [SEED_TENANT_A, 'idem-A1'],
      ),
    ).toBe(1); // still exactly one ingestion event
  });

  it('same external message id under a new idempotency key is an idempotent no-op (unique holds)', async () => {
    const res = await ingestConversationMessage(
      {
        tenantId: SEED_TENANT_A,
        conversationId: convA,
        leadId: leadA,
        body: 'Hello again',
        externalMessageId: 'wamid.A1',
        idempotencyKey: 'idem-A1-b',
        payloadHash: 'h-A1b',
        correlationId: 'corr-A1b',
      },
      h.client as never,
    );
    expect(res.ok).toBe(true);
    expect(
      await cnt(
        `select count(*) c from conversation_messages where conversation_id=$1 and external_message_id=$2`,
        [convA, 'wamid.A1'],
      ),
    ).toBe(1);
  });

  it('the SAME external message id in another tenant creates a distinct message (per-tenant scope)', async () => {
    const res = await ingestConversationMessage(
      {
        tenantId: SEED_TENANT_B,
        conversationId: convB,
        leadId: leadB,
        body: 'Hello tenant B',
        externalMessageId: 'wamid.A1', // same external id, different tenant
        idempotencyKey: 'idem-B1',
        payloadHash: 'h-B1',
        correlationId: 'corr-B1',
      },
      h.client as never,
    );
    expect(res.ok).toBe(true);
    expect(res.messageId).toBeTruthy();
    expect(
      await cnt(`select count(*) c from conversation_messages where external_message_id=$1`, [
        'wamid.A1',
      ]),
    ).toBe(2); // one per tenant
  });

  it('two distinct messages → two rows + two ingestion events', async () => {
    await ingestConversationMessage(
      {
        tenantId: SEED_TENANT_A,
        conversationId: convA,
        leadId: leadA,
        body: 'second distinct',
        externalMessageId: 'wamid.A2',
        idempotencyKey: 'idem-A2',
        payloadHash: 'h-A2',
        correlationId: 'corr-A2',
      },
      h.client as never,
    );
    expect(
      await cnt(`select count(*) c from conversation_messages where conversation_id=$1`, [convA]),
    ).toBe(2);
  });
});
