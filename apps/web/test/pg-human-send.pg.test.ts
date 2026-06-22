import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { bootEmbeddedPg, SEED_TENANT_A, SEED_TENANT_B, type BootedPg } from './pg-embedded';
import { makePgSupabase } from './pg-supabase';

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => h.client }));
vi.mock('@/lib/audit/request-context', () => ({
  getRequestContext: () =>
    Promise.resolve({ ip: null, userAgent: null, requestId: 'test', correlationId: 'test' }),
}));

import { simulateHumanSend } from '@/lib/integrations/human-send';

const AGENT = '00000000-0000-0000-0000-0000000000a2'; // seeded sales agent profile

let booted: BootedPg;
let pool: Pool;

const cnt = async (sql: string, params: unknown[]): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].c);

async function mkConv(
  tenant: string,
  opts: { status?: string; lastInbound?: string } = {},
): Promise<{ lead: string; conv: string }> {
  const lead = (await pool.query(`insert into leads(tenant_id) values ($1) returning id`, [tenant]))
    .rows[0].id as string;
  const conv = (
    await pool.query(
      `insert into conversations(tenant_id, lead_id, channel, status, last_inbound_at)
       values ($1,$2,'whatsapp',$3,$4) returning id`,
      [tenant, lead, opts.status ?? 'open', opts.lastInbound ?? new Date().toISOString()],
    )
  ).rows[0].id as string;
  return { lead, conv };
}

const send = (over: Record<string, unknown>) =>
  simulateHumanSend({
    tenantId: SEED_TENANT_A,
    actorUserId: AGENT,
    conversationId: '',
    channel: 'whatsapp_cloud',
    body: 'Hello, following up on your enquiry.',
    idempotencyKey: 'hs-default',
    ...over,
  } as never);

beforeAll(async () => {
  booted = await bootEmbeddedPg({ port: 5459, dir: '/tmp/pgtest/pghs' });
  pool = booted.pool;
  h.client = makePgSupabase(pool);
  // Tenant A: WhatsApp channel ENABLED. Tenant B: no channel row (disabled).
  await pool.query(
    `insert into communication_channels(tenant_id, channel_kind, enabled) values ($1,'whatsapp_cloud',true)`,
    [SEED_TENANT_A],
  );
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
});

describe('simulateHumanSend against EMBEDDED PostgreSQL (simulation only)', () => {
  it('successful simulation → ONE simulation row (simulated=true), and NO customer-visible effects', async () => {
    const { conv } = await mkConv(SEED_TENANT_A);
    const res = await send({ conversationId: conv, idempotencyKey: 'hs-ok' });
    expect(res.ok).toBe(true);
    expect(res.simulated).toBe(true);
    expect(res.blocked).toBe(false);
    expect(res.reason).toBe('simulated_not_sent');

    expect(
      await cnt(
        `select count(*) c from human_outbound_simulations s join human_outbound_requests r on r.id=s.request_id where r.conversation_id=$1 and s.simulated=true`,
        [conv],
      ),
    ).toBe(1);
    // Safety: no conversation message, no delivery event, waiting-on untouched.
    expect(
      await cnt(`select count(*) c from conversation_messages where conversation_id=$1`, [conv]),
    ).toBe(0);
    expect(
      await cnt(`select count(*) c from message_delivery_events where conversation_id=$1`, [conv]),
    ).toBe(0);
    const w = (await pool.query(`select waiting_on from conversations where id=$1`, [conv]))
      .rows[0];
    expect(w.waiting_on).toBe('none');
  });

  it('empty body is blocked, nothing written', async () => {
    const { conv } = await mkConv(SEED_TENANT_A);
    const res = await send({ conversationId: conv, body: '   ', idempotencyKey: 'hs-empty' });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('empty_body');
    expect(
      await cnt(`select count(*) c from human_outbound_requests where conversation_id=$1`, [conv]),
    ).toBe(0);
  });

  it('closed conversation is blocked', async () => {
    const { conv } = await mkConv(SEED_TENANT_A, { status: 'closed' });
    const res = await send({ conversationId: conv, idempotencyKey: 'hs-closed' });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('conversation_closed');
  });

  it('active DNC entry blocks the send', async () => {
    const { conv, lead } = await mkConv(SEED_TENANT_A);
    await pool.query(
      `insert into do_not_contact_entries(tenant_id, lead_id, channel, active) values ($1,$2,'any',true)`,
      [SEED_TENANT_A, lead],
    );
    const res = await send({ conversationId: conv, idempotencyKey: 'hs-dnc' });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('dnc_or_optout');
    expect(
      await cnt(
        `select count(*) c from human_outbound_simulations s join human_outbound_requests r on r.id=s.request_id where r.conversation_id=$1`,
        [conv],
      ),
    ).toBe(0);
  });

  it('withdrawn consent blocks the send', async () => {
    const { conv, lead } = await mkConv(SEED_TENANT_A);
    await pool.query(
      `insert into contact_consents(tenant_id, lead_id, channel, status) values ($1,$2,'any','revoked')`,
      [SEED_TENANT_A, lead],
    );
    const res = await send({ conversationId: conv, idempotencyKey: 'hs-consent' });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('consent_required');
  });

  it('disabled channel (tenant B, no channel row) blocks the send', async () => {
    const { conv } = await mkConv(SEED_TENANT_B);
    const res = await send({
      tenantId: SEED_TENANT_B,
      conversationId: conv,
      idempotencyKey: 'hs-chan',
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('channel_disabled');
  });

  it('idempotent replay (same key) returns the prior request, no second request row', async () => {
    const { conv } = await mkConv(SEED_TENANT_A);
    await send({ conversationId: conv, idempotencyKey: 'hs-idem' });
    const again = await send({ conversationId: conv, idempotencyKey: 'hs-idem' });
    expect(again.reason).toBe('idempotent_replay');
    expect(
      await cnt(`select count(*) c from human_outbound_requests where conversation_id=$1`, [conv]),
    ).toBe(1);
  });
});
