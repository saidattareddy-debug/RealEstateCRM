import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PoolClient } from 'pg';
import { bootEmbeddedPg, type BootedPg } from './pg-embedded';

/**
 * Phase 8 (automations & visits) RLS + safety harness against a REAL embedded
 * Postgres with migrations 0001–0029 applied. Proves: every new table is
 * RLS-enabled; the customer-send `will_send = false` CHECKs hold; the calendar /
 * notification CHECKs hold; one-active-enrollment uniqueness; cross-tenant SELECT
 * isolation; and permission-gated writes.
 */

const A = '11111111-1111-1111-1111-111111111111';
const AA = '00000000-0000-0000-0000-0000000000a1'; // tenant A client_admin
const AG = '00000000-0000-0000-0000-0000000000a2'; // tenant A sales_agent (no automations.manage)
const BA = '00000000-0000-0000-0000-0000000000b1'; // tenant B client_admin

let pg: BootedPg;
let leadA = '';
let autoA = '';
let seqA = '';

const PHASE8_TABLES = [
  'automations',
  'automation_actions',
  'automation_runs',
  'automation_run_actions',
  'followup_sequences',
  'followup_steps',
  'followup_enrollments',
  'followup_step_events',
  'site_visits',
  'visit_events',
  'visit_outcomes',
  'calendar_connections',
  'calendar_busy_blocks',
  'notifications',
  'notification_preferences',
  'notification_deliveries',
];

async function q(sql: string, params: unknown[] = []) {
  return pg.pool.query(sql, params);
}

/** Run `fn` as an authenticated user scoped to a tenant, then roll back. */
async function asUser<T>(uid: string, tenant: string, fn: () => Promise<T>): Promise<T> {
  const c = await pg.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid, role: 'authenticated', app_metadata: { active_tenant: tenant } }),
    ]);
    await c.query(`select set_config('app.current_tenant', $1, true)`, [tenant]);
    // expose the connection-bound query
    (asUser as unknown as { _c?: typeof c })._c = c;
    return await fn();
  } finally {
    await c.query('rollback');
    c.release();
  }
}
function cq(sql: string, params: unknown[] = []) {
  const c = (asUser as unknown as { _c: PoolClient })._c;
  return c.query(sql, params);
}

beforeAll(async () => {
  pg = await bootEmbeddedPg({ port: 54396, dir: '/tmp/pgtest8/data' });
  const lead = await q(`select id from public.leads where tenant_id = $1 limit 1`, [A]);
  leadA = lead.rows[0]?.id as string;
  const a = await q(
    `insert into public.automations (tenant_id, name, trigger, enabled) values ($1,'A','lead_score_changed',true) returning id`,
    [A],
  );
  autoA = a.rows[0].id as string;
  const s = await q(
    `insert into public.followup_sequences (tenant_id, name, enabled) values ($1,'S',true) returning id`,
    [A],
  );
  seqA = s.rows[0].id as string;
}, 120_000);

afterAll(async () => {
  if (pg) await pg.stop();
});

describe('Phase 8 — RLS enabled on every new table', () => {
  it('all 16 tables have row-level security', async () => {
    const r = await q(
      `select relname, relrowsecurity from pg_class where relname = any($1) and relkind='r'`,
      [PHASE8_TABLES],
    );
    expect(r.rows.length).toBe(PHASE8_TABLES.length);
    for (const row of r.rows) expect(row.relrowsecurity).toBe(true);
  });
});

describe('Phase 8 — SAFETY CHECK constraints', () => {
  it('automation_run_actions cannot record will_send = true', async () => {
    const run = await q(
      `insert into public.automation_runs (tenant_id, automation_id, trigger, matched) values ($1,$2,'lead_score_changed',true) returning id`,
      [A, autoA],
    );
    await expect(
      q(
        `insert into public.automation_run_actions (tenant_id, run_id, action_type, category, will_send) values ($1,$2,'send_email','customer_send',true)`,
        [A, run.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('followup_step_events cannot record will_send = true', async () => {
    const e = await q(
      `insert into public.followup_enrollments (tenant_id, sequence_id, lead_id) values ($1,$2,$3) returning id`,
      [A, seqA, leadA],
    );
    await expect(
      q(
        `insert into public.followup_step_events (tenant_id, enrollment_id, step_index, outcome, will_send) values ($1,$2,0,'send',true)`,
        [A, e.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('calendar_connections cannot be "connected" (simulation only)', async () => {
    await expect(
      q(
        `insert into public.calendar_connections (tenant_id, agent_id, provider, status) values ($1,$2,'google','connected')`,
        [A, AA],
      ),
    ).rejects.toThrow();
  });

  it('an external notification delivery must be simulated', async () => {
    const n = await q(
      `insert into public.notifications (tenant_id, recipient_user_id, kind, title) values ($1,$2,'lead_hot','x') returning id`,
      [A, AA],
    );
    await expect(
      q(
        `insert into public.notification_deliveries (tenant_id, notification_id, channel, simulated) values ($1,$2,'email',false)`,
        [A, n.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('at most one ACTIVE enrollment per (tenant, sequence, lead)', async () => {
    // Use a fresh sequence so this assertion is independent of earlier inserts.
    const s2 = await q(
      `insert into public.followup_sequences (tenant_id, name) values ($1,'S2') returning id`,
      [A],
    );
    const seq2 = s2.rows[0].id as string;
    await q(
      `insert into public.followup_enrollments (tenant_id, sequence_id, lead_id) values ($1,$2,$3)`,
      [A, seq2, leadA],
    );
    await expect(
      q(
        `insert into public.followup_enrollments (tenant_id, sequence_id, lead_id) values ($1,$2,$3)`,
        [A, seq2, leadA],
      ),
    ).rejects.toThrow();
  });
});

describe('Phase 8 — tenant isolation + permission gating (RLS)', () => {
  it('tenant A admin can read tenant A automations', async () => {
    const n = await asUser(AA, A, async () =>
      Number((await cq(`select count(*)::int c from public.automations`)).rows[0].c),
    );
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('tenant B admin cannot see tenant A automations', async () => {
    const n = await asUser(BA, '22222222-2222-2222-2222-222222222222', async () =>
      Number((await cq(`select count(*)::int c from public.automations`)).rows[0].c),
    );
    expect(n).toBe(0);
  });

  it('a role without automations.manage (sales_agent) cannot insert an automation', async () => {
    await expect(
      asUser(AG, A, async () =>
        cq(
          `insert into public.automations (tenant_id, name, trigger) values ($1,'x','lead_created')`,
          [A],
        ),
      ),
    ).rejects.toThrow();
  });
});
