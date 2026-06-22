import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateLeadScore,
  isProhibitedSignal,
  type LeadScoreResult,
  type SignalObservation,
  type SignalState,
  type SignalValue,
} from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { loadActiveModelVersion } from './model-loader';

/**
 * Phase 6A — lead score service (RECORD-ONLY / ADVISORY).
 *
 * `runLeadScore` loads the tenant's ACTIVE model version + rules, reads the
 * lead's current (non-superseded, non-expired) observations, runs the pure
 * deterministic engine, and PERSISTS the result as an immutable run +
 * components + a history append. It NEVER mutates the leads row, assignment,
 * pipeline stage, operational status, or any conversation — nothing here sends.
 * The exact model version id is always recorded on the run; prior runs are never
 * overwritten.
 */

export type ScoreTrigger =
  | 'manual'
  | 'recalculation'
  | 'observation_recorded'
  | 'model_activated'
  | 'extraction_approved';

export interface RunLeadScoreResult {
  ok: boolean;
  error?: string;
  runId?: string;
  result?: LeadScoreResult;
}

interface ObservationRow {
  signal_key: string;
  value: SignalValue;
  state: string;
  observed_at: string | null;
  confidence: string | null;
}

export async function runLeadScore(
  leadId: string,
  tenantId: string,
  trigger: ScoreTrigger = 'manual',
  client?: SupabaseClient,
  actorUserId?: string | null,
): Promise<RunLeadScoreResult> {
  const supabase = client ?? createSupabaseAdminClient();

  // Confirm the lead exists for this tenant (RLS-respecting when a scoped client
  // is passed). We READ ONLY — we never write to the leads row.
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'lead_not_found' };

  const model = await loadActiveModelVersion(supabase, tenantId);
  if (!model) return { ok: false, error: 'no_active_model' };

  const calculatedAt = new Date().toISOString();
  const nowMs = Date.now();

  // Current observations: not superseded, not expired. Prohibited keys are also
  // filtered defensively (the engine drops them too).
  const { data: obsRows } = await supabase
    .from('lead_signal_observations')
    .select('signal_key, value, state, observed_at, confidence')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .is('superseded_at', null)
    .order('observed_at', { ascending: false });

  const observations: SignalObservation[] = ((obsRows ?? []) as ObservationRow[])
    .filter((o) => !isProhibitedSignal(o.signal_key))
    .map((o) => ({
      signalKey: o.signal_key,
      value: o.value,
      state: o.state as SignalState,
      observedAt: o.observed_at ?? undefined,
      confidence: (o.confidence as SignalObservation['confidence']) ?? undefined,
    }));

  // Drop expired observations server-side (the engine has no concept of an
  // observation expiry; an expired observation must not contribute).
  const { data: expiredRows } = await supabase
    .from('lead_signal_observations')
    .select('signal_key')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .is('superseded_at', null)
    .not('expires_at', 'is', null)
    .lte('expires_at', new Date(nowMs).toISOString());
  const expiredKeys = new Set(
    ((expiredRows ?? []) as { signal_key: string }[]).map((r) => r.signal_key),
  );
  const liveObservations = observations.filter((o) => !expiredKeys.has(o.signalKey));

  const result = calculateLeadScore({
    modelVersion: model.domain,
    observations: liveObservations,
    calculatedAt,
  });

  // Read the prior run (for history previous_* fields) — read only.
  const { data: priorRun } = await supabase
    .from('lead_score_runs')
    .select('score, classification')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Persist an immutable run (model_version_id is always recorded).
  const { data: runRow, error: runError } = await supabase
    .from('lead_score_runs')
    .insert({
      tenant_id: tenantId,
      lead_id: leadId,
      model_version_id: model.modelVersionId,
      score: result.score,
      classification: result.classification,
      evidence_completeness: result.evidenceCompleteness,
      calculation_confidence: result.calculationConfidence,
      qualification_complete: result.qualificationComplete,
      disqualified: result.disqualification.disqualified,
      disqualification_reason: result.disqualification.reason ?? null,
      review_required: result.reviewRequired.required,
      review_reason: result.reviewRequired.reason ?? null,
      trigger,
      calculated_at: calculatedAt,
    })
    .select('id')
    .single();
  if (runError || !runRow) return { ok: false, error: runError?.message ?? 'run_insert_failed' };
  const runId = runRow.id as string;

  // Persist components (one per evaluated rule, applied or skipped).
  if (result.components.length > 0) {
    const componentRows = result.components.map((c) => ({
      tenant_id: tenantId,
      run_id: runId,
      rule_id: c.ruleId,
      group_key: c.group,
      signal_key: c.signalKey,
      contribution: c.contribution,
      applied: c.applied,
      skipped_reason: c.skippedReason ?? null,
      explanation: c.explanation,
    }));
    await supabase.from('lead_score_components').insert(componentRows);
  }

  // Append history — never overwrite prior runs.
  await supabase.from('lead_score_history').insert({
    tenant_id: tenantId,
    lead_id: leadId,
    run_id: runId,
    previous_score: (priorRun?.score as number | null) ?? null,
    new_score: result.score,
    previous_classification: (priorRun?.classification as string | null) ?? null,
    new_classification: result.classification,
    trigger,
    model_version: model.versionLabel,
    actor_id: actorUserId ?? null,
  });

  await writeAudit({
    action: priorRun ? 'SCORING_RECALCULATED' : 'SCORING_CALCULATED',
    tenantId,
    actorUserId: actorUserId ?? null,
    entityType: 'lead',
    entityId: leadId,
    metadata: {
      runId,
      modelVersionId: model.modelVersionId,
      modelVersion: model.versionLabel,
      classification: result.classification,
      score: result.score,
      trigger,
    },
  });

  return { ok: true, runId, result };
}
