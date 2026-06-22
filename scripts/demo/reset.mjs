/**
 * Demo reset: removes ONLY rows recorded in the ledger for a specific
 * (tenant, run_id), in FK-safe order. Never touches unrelated tenant data.
 *
 * Reset is driven entirely by demo_seed_entities — we delete the exact entity
 * ids we created, then mark the run 'reverted'. Anything not in the ledger is
 * left untouched (that is the safety guarantee verified by the tests).
 */

import { listEntities } from './ledger.mjs';

// FK-safe teardown order: children before parents. Maps entity_type → table +
// id column. Order matters (later rows reference earlier tables).
const DELETE_ORDER = [
  // --- Knowledge (children first; deleting the source cascades chunks /
  //     embeddings / versions / documents / approval events). Eval cases before
  //     their dataset. -----------------------------------------------------
  ['ai_evaluation_case', 'ai_evaluation_cases', 'id'],
  ['ai_evaluation_dataset', 'ai_evaluation_datasets', 'id'],
  ['knowledge_approval_event', 'knowledge_approval_events', 'id'],
  ['knowledge_source_version', 'knowledge_source_versions', 'id'],
  ['knowledge_source', 'knowledge_sources', 'id'], // cascades chunks/embeddings/docs
  // --- Conversations (deleting the conversation cascades messages / events /
  //     summaries; consent/DNC rows are deleted explicitly before leads). ---
  ['conversation_summary', 'conversation_summaries', 'id'],
  ['conversation_event', 'conversation_events', 'id'],
  ['conversation_message', 'conversation_messages', 'id'],
  ['consent_event', 'consent_events', 'id'],
  ['contact_consent', 'contact_consents', 'id'],
  ['dnc_entry', 'do_not_contact_entries', 'id'],
  ['conversation', 'conversations', 'id'],
  ['lead_match_run', 'lead_match_runs', 'id'],
  ['lead_score_run', 'lead_score_runs', 'id'],
  ['task', 'tasks', 'id'],
  ['lead', 'leads', 'id'], // cascades preferences/tags/assignments/notes/history
  ['inventory_unit', 'inventory_units', 'id'], // cascades status/price history
  ['project_document', 'project_documents', 'id'],
  ['project_media', 'project_media', 'id'],
  ['project_faq', 'project_faqs', 'id'],
  ['project_offer', 'project_offers', 'id'],
  ['project_amenity', 'project_amenities', 'id'],
  ['project_configuration', 'project_configurations', 'id'],
  ['project', 'projects', 'id'],
];

export async function runReset(admin, ctx, deps = {}) {
  const { tenantId, runId, dryRun, log = () => {} } = ctx;
  await deps.audit?.('demo.reset.started', { runId });

  const entities = await listEntities(admin, runId);
  const byType = new Map();
  for (const e of entities) {
    if (!byType.has(e.entity_type)) byType.set(e.entity_type, []);
    byType.get(e.entity_type).push(e.entity_id);
  }

  const removed = {};
  for (const [type, table, idCol] of DELETE_ORDER) {
    const ids = byType.get(type) ?? [];
    removed[type] = ids.length;
    if (dryRun || ids.length === 0) continue;
    // Tenant-scoped delete of exactly the recorded ids (defense in depth).
    await admin.from(table).delete().eq('tenant_id', tenantId).in(idCol, ids);
    log(`removed ${ids.length} ${type}`);
  }

  if (!dryRun) {
    // Drop the entity ledger rows then mark the run reverted.
    await admin.from('demo_seed_entities').delete().eq('run_id', runId).eq('tenant_id', tenantId);
    await admin
      .from('demo_seed_runs')
      .update({ status: 'reverted', completed_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('tenant_id', tenantId);
  }

  await deps.audit?.('demo.reset.completed', { runId, removed });
  return { runId, removed };
}
