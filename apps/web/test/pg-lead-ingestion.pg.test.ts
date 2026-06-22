import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { bootEmbeddedPg, SEED_TENANT_A, type BootedPg } from './pg-embedded';
import { makePgSupabase } from './pg-supabase';

// ingestLead + writeAudit both build their own admin client → point them all at
// the same pg-backed shim so the WHOLE path runs against embedded Postgres.
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => h.client }));
// getRequestContext() reads Next `headers()`, which throws outside a request scope.
// Stub it so writeAudit can run (audit_logs is written through the pg shim).
vi.mock('@/lib/audit/request-context', () => ({
  getRequestContext: () =>
    Promise.resolve({ ip: null, userAgent: null, requestId: 'test', correlationId: 'test' }),
}));

import { ingestLead } from '@/lib/leads/ingest';

let booted: BootedPg;
let pool: Pool;

const cnt = async (sql: string, params: unknown[]): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].c);

beforeAll(async () => {
  booted = await bootEmbeddedPg({ port: 5458, dir: '/tmp/pgtest/pglead' });
  pool = booted.pool;
  h.client = makePgSupabase(pool);
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
});

describe('ingestLead against EMBEDDED PostgreSQL (real canonical lead service)', () => {
  it('new lead → lead row + completed event + source event + first/last attribution + assignment', async () => {
    const res = await ingestLead(
      SEED_TENANT_A,
      {
        fullName: 'Asha Rao',
        phone: '+91 98765 40001',
        email: 'Asha@Example.com',
        source: 'nobroker',
        sourceLeadId: 'NB-1',
      },
      { sourceKind: 'portal', idempotencyKey: 'lead-idem-1' },
    );
    expect(res.status).toBe('completed');
    expect(res.leadId).toBeTruthy();

    // Phone normalized to E.164 on the persisted lead.
    const lead = (await pool.query(`select * from leads where id=$1`, [res.leadId])).rows[0];
    expect(lead.primary_phone_e164).toBe('+919876540001');

    // Exactly one completed ingestion event linked to the lead.
    expect(
      await cnt(
        `select count(*) c from lead_ingestion_events where idempotency_key=$1 and status='completed' and resulting_lead_id=$2`,
        ['lead-idem-1', res.leadId],
      ),
    ).toBe(1);
    // One source event.
    expect(
      await cnt(`select count(*) c from lead_source_events where lead_id=$1`, [res.leadId]),
    ).toBe(1);
    // First + last attribution touchpoints for the new lead.
    expect(
      await cnt(`select count(*) c from attribution_touchpoints where lead_id=$1`, [res.leadId]),
    ).toBe(2);
    expect(
      await cnt(
        `select count(*) c from attribution_touchpoints where lead_id=$1 and touch_type in ('first','last')`,
        [res.leadId],
      ),
    ).toBe(2);
    // Auto-assigned to the seeded sales agent.
    expect(res.assignedAgentId).toBeTruthy();
    expect(
      await cnt(`select count(*) c from lead_assignments where lead_id=$1 and active=true`, [
        res.leadId,
      ]),
    ).toBe(1);
    // Audit event written.
    expect(
      await cnt(`select count(*) c from audit_logs where entity_id=$1 and action='lead.create'`, [
        res.leadId,
      ]),
    ).toBe(1);
  });

  it('duplicate external event (identical payload + key) → idempotent hit, no second lead', async () => {
    const before = await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A]);
    // IDENTICAL input to the first test → same payload hash → idempotent completion.
    const res = await ingestLead(
      SEED_TENANT_A,
      {
        fullName: 'Asha Rao',
        phone: '+91 98765 40001',
        email: 'Asha@Example.com',
        source: 'nobroker',
        sourceLeadId: 'NB-1',
      },
      { sourceKind: 'portal', idempotencyKey: 'lead-idem-1' },
    );
    expect(res.idempotentHit).toBe(true);
    expect(res.status).toBe('completed');
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      before,
    );
  });

  it('same key + DIFFERENT payload is rejected (idempotency conflict, never a silent overwrite)', async () => {
    const res = await ingestLead(
      SEED_TENANT_A,
      { fullName: 'Different Person', phone: '+91 90000 00000', source: 'nobroker' },
      { sourceKind: 'portal', idempotencyKey: 'lead-idem-1' },
    );
    expect(res.idempotentHit).toBe(true);
    expect(res.status).toBe('rejected');
  });

  it('existing lead by phone → new lead created AND a duplicate-review row flagged (never merged)', async () => {
    const res = await ingestLead(
      SEED_TENANT_A,
      {
        fullName: 'Asha R.',
        phone: '+91 98765 40001',
        email: 'asha2@example.com',
        source: 'website',
      },
      { sourceKind: 'form', idempotencyKey: 'lead-idem-2' },
    );
    expect(res.status).toBe('completed');
    expect(res.leadId).toBeTruthy();
    // The phone collides with the first lead → at least one duplicate-review row.
    expect(
      await cnt(`select count(*) c from lead_duplicates where lead_id=$1`, [res.leadId]),
    ).toBeGreaterThanOrEqual(1);
    // The original lead still exists (no silent merge).
    expect(
      await cnt(`select count(*) c from leads where primary_phone_e164='+919876540001'`, []),
    ).toBeGreaterThanOrEqual(2);
  });

  it('broker/direct overlap is flagged on the duplicate row', async () => {
    // portal (third-party) incoming vs the existing direct lead from the prior test.
    const res = await ingestLead(
      SEED_TENANT_A,
      { fullName: 'Asha portal', phone: '+91 98765 40001', source: '99acres' },
      { sourceKind: 'portal', idempotencyKey: 'lead-idem-3' },
    );
    expect(
      await cnt(
        `select count(*) c from lead_duplicates where lead_id=$1 and is_broker_conflict=true`,
        [res.leadId],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('replay after a prior success is idempotent (same lead, no new rows)', async () => {
    const beforeLeads = await cnt(`select count(*) c from leads where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const first = await ingestLead(
      SEED_TENANT_A,
      { fullName: 'Replay Person', phone: '+91 98765 49999', source: 'website' },
      { sourceKind: 'form', idempotencyKey: 'lead-idem-replay' },
    );
    const replay = await ingestLead(
      SEED_TENANT_A,
      { fullName: 'Replay Person', phone: '+91 98765 49999', source: 'website' },
      { sourceKind: 'form', idempotencyKey: 'lead-idem-replay' },
    );
    expect(replay.idempotentHit).toBe(true);
    expect(replay.leadId).toBe(first.leadId);
    // Only the first call created a lead.
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      beforeLeads + 1,
    );
  });
});
