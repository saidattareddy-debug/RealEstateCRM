#!/usr/bin/env node
/**
 * Show the demo-seed ledger status for a tenant (read-only; no safety gate
 * needed because it never writes). Prints the run, its status, counts, and the
 * number of ledger-tracked entities by type.
 *
 *   pnpm demo:status --tenant northwind-estates
 */
import { parseArgs } from './demo/cli.mjs';
import { createCliAdminClient, resolveTenant } from './demo/admin.mjs';
import { runIdFor } from './demo/ids.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const admin = await createCliAdminClient(process.env);
  const tenant = await resolveTenant(admin, { tenantArg: opts.tenant, allowCreate: false });
  const runId = runIdFor(tenant.id, opts.datasetVersion);

  const { data: run } = await admin
    .from('demo_seed_runs')
    .select('id, dataset_version, run_id, status, started_at, completed_at, counts')
    .eq('tenant_id', tenant.id)
    .eq('run_id', runId)
    .maybeSingle();

  console.log('\n=== Demo seed status ===');
  console.log('  Tenant :', `${tenant.name} (${tenant.slug})`);
  console.log('  Dataset:', opts.datasetVersion);
  if (!run) {
    console.log('  Status : NO RUN FOUND — nothing seeded for this dataset.\n');
    return;
  }
  console.log('  Run id :', run.id);
  console.log('  Status :', run.status);
  console.log('  Started:', run.started_at);
  console.log('  Ended  :', run.completed_at ?? '(in progress)');
  console.log('  Counts :', JSON.stringify(run.counts));

  const { data: ents } = await admin
    .from('demo_seed_entities')
    .select('entity_type')
    .eq('tenant_id', tenant.id)
    .eq('run_id', run.id);
  const byType = {};
  for (const e of ents ?? []) byType[e.entity_type] = (byType[e.entity_type] ?? 0) + 1;
  console.log('  Ledger entities:', JSON.stringify(byType));

  const c = run.counts ?? {};
  console.log(
    '  Conversations  :',
    byType.conversation ?? c.conversations ?? 0,
    `(messages ${byType.conversation_message ?? c.messages ?? 0},`,
    `consents ${byType.contact_consent ?? c.consents ?? 0},`,
    `DNC ${byType.dnc_entry ?? c.dnc_entries ?? 0})`,
  );
  console.log(
    '  Knowledge docs :',
    byType.knowledge_source ?? c.knowledge_docs ?? 0,
    `(chunks ${c.knowledge_chunks ?? 0},`,
    `mock embeddings ${c.mock_embeddings ?? 0},`,
    `eval cases ${byType.ai_evaluation_case ?? c.knowledge_eval_cases ?? 0})`,
  );
  console.log('========================\n');
}

main().catch((e) => {
  console.error('demo:status failed:', e.message);
  process.exit(1);
});
