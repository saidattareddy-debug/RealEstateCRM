import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateProjectMatches,
  isProhibitedSignal,
  type LeadSnapshot,
  type MatchCandidate,
  type MatchRunResult,
  type PreferenceValue,
} from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { loadActiveMatchModelVersion } from './model-loader';
import { generateCandidates } from './candidate-service';

/**
 * Phase 6B — lead match service (ADVISORY / RECORD-ONLY).
 *
 * `runLeadMatch` loads the tenant's ACTIVE matching model version, builds the
 * lead's preference snapshot, generates candidate projects/configs/units from
 * REAL data (under the caller's RLS-scoped client) and runs the pure engine,
 * then PERSISTS an immutable run + candidates + components + inventory snapshots.
 *
 * It NEVER mutates the lead, its assignment, pipeline stage, operational status,
 * score, or any inventory; it never reserves and never sends. The exact model
 * version id is always recorded on the run; prior runs are never overwritten.
 *
 * The caller MUST pass its RLS-scoped server client (`client`) so all READS and
 * candidate generation only ever see projects/leads the user may see. The match
 * RESULT rows (run/candidates/components/snapshots) are written with the service
 * role — they have no client-facing insert policy by design (read-only via RLS).
 */

export type MatchTrigger =
  | 'manual'
  | 'recalculation'
  | 'preference_changed'
  | 'inventory_changed'
  | 'model_activated'
  | 'extraction_approved';

export interface RunLeadMatchResult {
  ok: boolean;
  error?: string;
  runId?: string;
  result?: MatchRunResult;
}

interface PreferenceRow {
  budget_min: number | null;
  budget_max: number | null;
  configuration: string | null;
  preferred_location: string | null;
  purchase_timeline: string | null;
  purpose: string | null;
  preferred_budget?: number | null;
  absolute_max_budget?: number | null;
  amenities?: string[] | null;
  excluded_localities?: string[] | null;
}

/** Build a fairness-filtered lead preference snapshot from real lead data. */
function buildLeadSnapshot(pref: PreferenceRow | null): {
  snapshot: LeadSnapshot;
  excludedLocalities: string[];
} {
  const preferences: Record<string, PreferenceValue> = {};
  const set = (k: string, v: PreferenceValue) => {
    if (v === undefined || v === null) return;
    if (isProhibitedSignal(k)) return;
    preferences[k] = v;
  };

  const budgetMin = pref?.budget_min ?? undefined;
  const budgetMax = pref?.budget_max ?? undefined;
  if (budgetMin !== undefined || budgetMax !== undefined) {
    set('budget', { min: budgetMin, max: budgetMax });
  }
  if (pref?.configuration) set('configuration', pref.configuration);
  if (pref?.preferred_location) set('locality', pref.preferred_location);
  if (pref?.purchase_timeline) set('purchaseTimeline', pref.purchase_timeline);
  if (pref?.purpose) set('purpose', pref.purpose);
  const amenities = Array.isArray(pref?.amenities) ? pref?.amenities : null;
  if (amenities && amenities.length > 0) set('amenities', amenities);
  const excludedLocalities = Array.isArray(pref?.excluded_localities)
    ? (pref?.excluded_localities as string[])
    : [];
  if (excludedLocalities.length > 0) set('excludedLocalities', excludedLocalities);

  return {
    snapshot: {
      preferences,
      budgetMin,
      budgetMax,
      preferredBudget: pref?.preferred_budget ?? undefined,
      absoluteMaxBudget: pref?.absolute_max_budget ?? undefined,
    },
    excludedLocalities,
  };
}

export async function runLeadMatch(
  leadId: string,
  tenantId: string,
  trigger: MatchTrigger,
  client: SupabaseClient,
  actorUserId?: string | null,
): Promise<RunLeadMatchResult> {
  // Confirm the lead exists for this tenant (RLS-respecting). We READ ONLY.
  const { data: lead } = await client
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'lead_not_found' };

  const model = await loadActiveMatchModelVersion(client, tenantId);
  if (!model) return { ok: false, error: 'no_active_model' };

  const { data: prefRow } = await client
    .from('lead_preferences')
    .select('budget_min, budget_max, configuration, preferred_location, purchase_timeline, purpose')
    .eq('lead_id', leadId)
    .maybeSingle();
  const { snapshot, excludedLocalities } = buildLeadSnapshot(prefRow as PreferenceRow | null);

  const calculatedAt = new Date().toISOString();
  const inventorySnapshotAt = calculatedAt;

  const candidates: MatchCandidate[] = await generateCandidates(client, tenantId, model.domain, {
    excludedLocalities,
  });

  const result = calculateProjectMatches({
    modelVersion: model.domain,
    leadSnapshot: snapshot,
    candidates,
    calculatedAt,
  });

  // Persistence uses the service-role client: result tables are read-only via RLS.
  const admin = createSupabaseAdminClient();

  // Was there a prior run (to choose calculated vs recalculated audit action)?
  const { data: priorRun } = await admin
    .from('lead_match_runs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Persist an immutable run (model_version_id always recorded). Writes use the
  // caller's RLS-scoped client; the lead row itself is never touched.
  const { data: runRow, error: runError } = await admin
    .from('lead_match_runs')
    .insert({
      tenant_id: tenantId,
      lead_id: leadId,
      model_version_id: model.modelVersionId,
      preference_snapshot: snapshot.preferences,
      qualification_snapshot: {
        budgetMin: snapshot.budgetMin ?? null,
        budgetMax: snapshot.budgetMax ?? null,
        preferredBudget: snapshot.preferredBudget ?? null,
        absoluteMaxBudget: snapshot.absoluteMaxBudget ?? null,
      },
      inventory_snapshot_at: inventorySnapshotAt,
      trigger,
      calculated_at: calculatedAt,
    })
    .select('id')
    .single();
  if (runError || !runRow) return { ok: false, error: runError?.message ?? 'run_insert_failed' };
  const runId = runRow.id as string;

  // Persist candidates (ranked) + components + inventory snapshots.
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  for (const r of result.rankedCandidates) {
    const { data: candRow, error: candError } = await admin
      .from('lead_match_candidates')
      .insert({
        tenant_id: tenantId,
        run_id: runId,
        level: r.level,
        project_id: r.projectId,
        project_configuration_id: r.projectConfigurationId ?? null,
        inventory_unit_id: r.inventoryUnitId ?? null,
        eligible: r.eligible,
        score: r.score,
        classification: r.classification,
        confidence: r.confidence,
        preference_completeness: r.preferenceCompleteness,
        inventory_state: r.inventoryState,
        unit_confirmed: r.unitConfirmedAvailable,
        budget_outcome: r.budgetOutcome,
        rank: r.rank,
        hard_failures: r.hardFailures,
      })
      .select('id')
      .single();
    if (candError || !candRow) continue;
    const candidateId = candRow.id as string;

    const components = [...r.positiveComponents, ...r.negativeComponents];
    if (components.length > 0) {
      await admin.from('lead_match_components').insert(
        components.map((c) => ({
          tenant_id: tenantId,
          candidate_id: candidateId,
          rule_id: c.ruleId,
          group_key: c.group,
          kind: c.kind,
          signal_key: c.signalKey,
          contribution: c.contribution,
          applied: c.applied,
          positive: c.positive,
          skipped_reason: c.skippedReason ?? null,
          explanation: c.explanation,
        })),
      );
    }

    // Capture a truthful inventory snapshot for unit candidates.
    const src = candidateById.get(r.candidateId);
    if (r.level === 'unit' && src) {
      await admin.from('lead_match_inventory_snapshots').insert({
        tenant_id: tenantId,
        run_id: runId,
        inventory_unit_id: r.inventoryUnitId ?? null,
        project_id: r.projectId,
        configuration_id: r.projectConfigurationId ?? null,
        status: src.unitStatus ?? null,
        verified_at: src.unitVerifiedAt ?? null,
        // Price provenance: the exact price + its verification time used by this
        // run, plus the freshness policy and resulting state, so the historical
        // explanation stays reproducible after inventory changes.
        price: src.unitPrice ?? null,
        price_verified_at: src.unitVerifiedAt ?? null,
        freshness_window_days: model.domain.freshnessWindowDays,
        freshness_state: r.inventoryState,
      });
    }
  }

  await writeAudit({
    action: priorRun ? 'MATCHING_RECALCULATED' : 'MATCHING_CALCULATED',
    tenantId,
    actorUserId: actorUserId ?? null,
    entityType: 'lead',
    entityId: leadId,
    metadata: {
      runId,
      modelVersionId: model.modelVersionId,
      modelVersion: model.versionLabel,
      candidates: result.rankedCandidates.length,
      trigger,
    },
  });

  return { ok: true, runId, result };
}
