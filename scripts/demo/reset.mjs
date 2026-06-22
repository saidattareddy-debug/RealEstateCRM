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
  // --- Phase 8 & 9 (parents/standalone; cascades handle children). Deleted
  //     BEFORE leads so a lead delete never cascades a demo visit/enrollment
  //     out of order. The optional 4th element = skip the tenant_id filter
  //     (platform-scope system_health_checks have a NULL tenant_id). --------
  ['automation_run', 'automation_runs', 'id'],
  ['automation', 'automations', 'id'], // cascades actions/runs/run_actions
  ['followup_sequence', 'followup_sequences', 'id'], // cascades steps/enrollments/events
  ['site_visit', 'site_visits', 'id'], // cascades visit events/outcomes
  ['calendar_busy_block', 'calendar_busy_blocks', 'id'],
  ['calendar_connection', 'calendar_connections', 'id'],
  ['notification', 'notifications', 'id'], // cascades deliveries
  ['notification_preference', 'notification_preferences', 'id'],
  ['usage_counter', 'usage_counters', 'id'],
  ['billing_period', 'billing_periods', 'id'],
  ['system_health_check', 'system_health_checks', 'id', true], // platform rows have null tenant
  ['analytics_export_log', 'analytics_export_logs', 'id'],
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
  for (const [type, table, idCol, noTenantScope] of DELETE_ORDER) {
    const ids = byType.get(type) ?? [];
    removed[type] = ids.length;
    if (dryRun || ids.length === 0) continue;
    // Delete EXACTLY the recorded ids. Tenant-scoped (defense in depth) except
    // for tables that legitimately hold platform-scope (null-tenant) rows.
    if (noTenantScope) {
      await admin.from(table).delete().in(idCol, ids);
    } else {
      await admin.from(table).delete().eq('tenant_id', tenantId).in(idCol, ids);
    }
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
