#!/usr/bin/env node
/**
 * STAGING demo-data generator — controlled-MVP, safe, deterministic, idempotent.
 *
 *   pnpm demo:seed --tenant northwind-estates --dry-run
 *   pnpm demo:seed --tenant northwind-estates --confirm
 *
 * REFUSES unless the full safety gate passes (see scripts/demo/safety.mjs). Never
 * sends, never calls external services, never touches production. Writes only
 * clearly-synthetic data, all recorded in the demo_seed ledger for reversibility.
 *
 * Leads/scoring/matching require the canonical server services (TypeScript). The
 * CLI runs them only when a compiled bridge is available; otherwise it seeds the
 * service-role sections and prints how to run the fully-canonical path (the
 * embedded-PG harness). See docs/DEMO_DATA.md.
 */
import { runIdFor } from './demo/ids.mjs';
import { assertSafe, SafetyError } from './demo/safety.mjs';
import { parseArgs, makeAuditWriter } from './demo/cli.mjs';
import { createCliAdminClient, resolveTenant } from './demo/admin.mjs';
import { runSeed } from './demo/seeder.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { env } = loadLocalEnv();

  // 1) Safety gate — refuse loudly with reasons if anything is unsafe.
  let target;
  try {
    target = assertSafe(env, opts);
  } catch (e) {
    if (e instanceof SafetyError) {
      console.error('\nDEMO SEED REFUSED — safety gate failed:');
      for (const p of e.problems) console.error('  - ' + p);
      console.error('\nNo database connection was opened. Fix the above and retry.\n');
      process.exit(2);
    }
    throw e;
  }

  // 2) Connect + resolve tenant.
  const admin = await createCliAdminClient(env);
  const tenant = await resolveTenant(admin, {
    tenantArg: opts.tenant,
    allowCreate: opts.createTenant,
  });
  if (!tenant) {
    console.error('Tenant creation via --create-tenant is intentionally not automated in the CLI.');
    console.error('Create the Northwind Estates staging tenant first, then re-run.');
    process.exit(2);
  }

  // 3) Print the plan (host only — never the key, never the full URL secrets).
  console.log('\n=== Demo seed plan ===');
  console.log('  Supabase host :', target.supabaseHost ?? '(local)');
  console.log('  Tenant        :', `${tenant.name} (${tenant.slug}) ${tenant.id}`);
  console.log('  Dataset       :', opts.datasetVersion);
  console.log('  Mode          :', opts.dryRun ? 'DRY-RUN (no writes)' : 'WRITE (--confirm)');
  console.log('  Row plan      : ~7 profiles, 3 projects, 8 configs, 48 inventory units,');
  console.log('                  40 leads, ~25 tasks, advisory score/match runs,');
  console.log(
    '                  ~15 conversations / 50-70 messages (canonical ingest, NO AI reply),',
  );
  console.log('                  ~10 knowledge docs + mock embeddings + >=20-question eval set');
  console.log('======================\n');

  const correlationId = `demo-${Date.now()}`;
  const audit = makeAuditWriter(admin, {
    tenantId: tenant.id,
    datasetVersion: opts.datasetVersion,
    correlationId,
    actorUserId: null,
  });

  const started = Date.now();
  const result = await runSeed(
    admin,
    {
      tenantId: tenant.id,
      datasetVersion: opts.datasetVersion,
      dryRun: opts.dryRun,
      correlationId,
      log: (m) => console.log('  ·', m),
    },
    {
      audit,
      // Canonical service callables are wired in by tests / a compiled bridge.
      // When absent, leads/scoring/matching are skipped (service-role sections
      // still seed). The embedded-PG harness exercises the full canonical path.
    },
  );

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\nDone in', secs + 's');
  console.log('Counts:', JSON.stringify(result.counts));
  if (opts.dryRun) console.log('\nDRY-RUN complete — nothing was written.');
  else console.log('\nrun_id:', runIdFor(tenant.id, opts.datasetVersion));
}

main().catch((e) => {
  console.error('demo:seed failed:', e.message);
  process.exit(1);
});
