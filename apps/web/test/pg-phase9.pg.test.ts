import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootEmbeddedPg, type BootedPg } from './pg-embedded';

/**
 * Phase 9 (analytics & administration) RLS + constraint harness against a real
 * embedded Postgres with migrations 0001–0030 applied.
 */

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const AA = '00000000-0000-0000-0000-0000000000a1'; // tenant A client_admin
const AG = '00000000-0000-0000-0000-0000000000a2'; // tenant A sales_agent (no billing.manage)
const BA = '00000000-0000-0000-0000-0000000000b1'; // tenant B client_admin

let pg: BootedPg;

const PHASE9_TABLES = [
  'usage_counters',
  'billing_periods',
  'system_health_checks',
  'analytics_export_logs',
];

const q = (sql: string, params: unknown[] = []) => pg.pool.query(sql, params);

async function asUser<T>(
  uid: string,
  tenant: string,
  fn: (c: import('pg').PoolClient) => Promise<T>,
) {
  const c = await pg.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid, role: 'authenticated', app_metadata: { active_tenant: tenant } }),
    ]);
    await c.query(`select set_config('app.current_tenant', $1, true)`, [tenant]);
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

beforeAll(async () => {
  pg = await bootEmbeddedPg({ port: 54389, dir: '/tmp/pgtest9/data' });
  await q(
    `insert into public.usage_counters (tenant_id, metric, period_start, period_end, used) values ($1,'ai_tokens','2026-06-01','2026-06-30',1234)`,
    [A],
  );
  await q(
    `insert into public.billing_periods (tenant_id, period_start, period_end, plan_tier, status) values ($1,'2026-06-01','2026-06-30','growth','open')`,
    [A],
  );
}, 120_000);

afterAll(async () => {
  if (pg) await pg.stop();
});

describe('Phase 9 — RLS + constraints', () => {
  it('all 4 tables are RLS-enabled', async () => {
    const r = await q(
      `select relname, relrowsecurity from pg_class where relname = any($1) and relkind='r'`,
      [PHASE9_TABLES],
    );
    expect(r.rows.length).toBe(PHASE9_TABLES.length);
    for (const row of r.rows) expect(row.relrowsecurity).toBe(true);
  });

  it('billing_periods rejects an invalid status', async () => {
    await expect(
      q(
        `insert into public.billing_periods (tenant_id, period_start, period_end, status) values ($1,'2026-07-01','2026-07-31','bogus')`,
        [A],
      ),
    ).rejects.toThrow();
  });

  it('analytics_export_logs rejects an invalid format', async () => {
    await expect(
      q(
        `insert into public.analytics_export_logs (tenant_id, report, format) values ($1,'funnel','pdf')`,
        [A],
      ),
    ).rejects.toThrow();
  });

  it('usage_counters forbids negative usage', async () => {
    await expect(
      q(
        `insert into public.usage_counters (tenant_id, metric, period_start, period_end, used) values ($1,'x','2026-08-01','2026-08-31',-1)`,
        [A],
      ),
    ).rejects.toThrow();
  });
});

describe('Phase 9 — tenant isolation + permission gating', () => {
  it('tenant A admin reads tenant A usage; tenant B admin cannot', async () => {
    const nA = await asUser(AA, A, async (c) =>
      Number((await c.query(`select count(*)::int c from public.usage_counters`)).rows[0].c),
    );
    expect(nA).toBeGreaterThanOrEqual(1);
    const nB = await asUser(BA, B, async (c) =>
      Number((await c.query(`select count(*)::int c from public.usage_counters`)).rows[0].c),
    );
    expect(nB).toBe(0);
  });

  it('a role without billing.manage cannot insert a billing period', async () => {
    await expect(
      asUser(AG, A, async (c) =>
        c.query(
          `insert into public.billing_periods (tenant_id, period_start, period_end) values ($1,'2026-09-01','2026-09-30')`,
          [A],
        ),
      ),
    ).rejects.toThrow();
  });
});
