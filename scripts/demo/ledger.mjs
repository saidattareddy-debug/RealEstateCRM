import { deterministicUuid, runIdFor } from './ids.mjs';

/**
 * Ledger helpers over demo_seed_runs / demo_seed_entities (migration 0028).
 *
 * Every helper takes a Supabase-shaped `admin` client (service-role / RLS-exempt
 * in production; the pg-shim in tests). The ledger is the source of truth for
 * idempotency (find-or-create the run) and reversibility (record every entity).
 */

/** Find an existing non-reverted run for (tenant, dataset) or create one. */
export async function findOrCreateRun(admin, tenantId, datasetVersion, correlationId) {
  const runId = runIdFor(tenantId, datasetVersion);
  const { data: existing } = await admin
    .from('demo_seed_runs')
    .select('id, status, run_id, counts')
    .eq('tenant_id', tenantId)
    .eq('run_id', runId)
    .maybeSingle();

  if (existing && existing.status !== 'reverted') {
    return { id: existing.id, runId, created: false, status: existing.status };
  }

  const id = deterministicUuid(tenantId, 'seed_run', runId);
  // Upsert-by-deterministic-id keeps a re-seed after a revert idempotent.
  const { data: inserted, error } = await admin
    .from('demo_seed_runs')
    .insert({
      id,
      tenant_id: tenantId,
      dataset_version: datasetVersion,
      run_id: runId,
      status: 'running',
      correlation_id: correlationId,
    })
    .select('id')
    .maybeSingle();
  if (error && error.code !== '23505') throw new Error('ledger run insert: ' + error.message);
  return { id: inserted?.id ?? id, runId, created: true, status: 'running' };
}

/** Record one synthetic entity. Idempotent on (run_id, entity_type, entity_id). */
export async function recordEntity(admin, tenantId, runId, entityType, entityId, externalRef) {
  const id = deterministicUuid(tenantId, 'entity', `${runId}|${entityType}|${entityId}`);
  const { error } = await admin
    .from('demo_seed_entities')
    .insert({
      id,
      tenant_id: tenantId,
      run_id: runId,
      entity_type: entityType,
      entity_id: String(entityId),
      external_ref: externalRef ?? null,
    })
    .select('id')
    .maybeSingle();
  if (error && error.code !== '23505') throw new Error('ledger entity insert: ' + error.message);
}

/** Has an entity of this type+id already been recorded for this run? */
export async function entityExists(admin, runId, entityType, entityId) {
  const { data } = await admin
    .from('demo_seed_entities')
    .select('id')
    .eq('run_id', runId)
    .eq('entity_type', entityType)
    .eq('entity_id', String(entityId))
    .maybeSingle();
  return !!data;
}

export async function completeRun(admin, runId, counts) {
  await admin
    .from('demo_seed_runs')
    .update({ status: 'completed', completed_at: new Date().toISOString(), counts })
    .eq('id', runId);
}

export async function failRun(admin, runId, counts) {
  await admin
    .from('demo_seed_runs')
    .update({ status: 'failed', completed_at: new Date().toISOString(), counts })
    .eq('id', runId);
}

export async function listEntities(admin, runId) {
  const { data } = await admin
    .from('demo_seed_entities')
    .select('id, entity_type, entity_id')
    .eq('run_id', runId);
  return data ?? [];
}
