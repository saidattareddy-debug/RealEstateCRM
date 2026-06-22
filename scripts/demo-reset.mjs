#!/usr/bin/env node
/**
 * Remove ONLY the rows belonging to this tenant's demo run (ledger-driven,
 * FK-safe order). Never touches unrelated tenant data. Requires --confirm.
 *
 *   pnpm demo:reset --tenant northwind-estates --dry-run
 *   pnpm demo:reset --tenant northwind-estates --confirm
 */
import { parseArgs, makeAuditWriter } from './demo/cli.mjs';
import { createCliAdminClient, resolveTenant } from './demo/admin.mjs';
import { runReset } from './demo/reset.mjs';
import { runIdFor } from './demo/ids.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun && !opts.confirm) {
    console.error('demo:reset requires --confirm (or use --dry-run to preview).');
    process.exit(2);
  }
  const admin = await createCliAdminClient(process.env);
  const tenant = await resolveTenant(admin, { tenantArg: opts.tenant, allowCreate: false });
  const runIdStr = runIdFor(tenant.id, opts.datasetVersion);

  const { data: run } = await admin
    .from('demo_seed_runs')
    .select('id, status')
    .eq('tenant_id', tenant.id)
    .eq('run_id', runIdStr)
    .maybeSingle();
  if (!run) {
    console.log('No demo run found for this tenant + dataset — nothing to reset.');
    return;
  }

  console.log('\n=== Demo reset plan ===');
  console.log('  Tenant :', `${tenant.name} (${tenant.slug})`);
  console.log('  Run    :', run.id, `(${run.status})`);
  console.log('  Mode   :', opts.dryRun ? 'DRY-RUN (no deletes)' : 'DELETE (--confirm)');
  console.log('=======================\n');

  const correlationId = `demo-reset-${Date.now()}`;
  const audit = makeAuditWriter(admin, {
    tenantId: tenant.id,
    datasetVersion: opts.datasetVersion,
    correlationId,
    actorUserId: null,
  });

  const res = await runReset(
    admin,
    { tenantId: tenant.id, runId: run.id, dryRun: opts.dryRun, log: (m) => console.log('  ·', m) },
    { audit },
  );
  console.log('\nRemoved (by type):', JSON.stringify(res.removed));
  if (opts.dryRun) console.log('DRY-RUN — nothing was deleted.');
}

main().catch((e) => {
  console.error('demo:reset failed:', e.message);
  process.exit(1);
});
