import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchClassification } from '@re/domain';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 6B — match overrides + feedback (ADVISORY).
 *
 * An override records a manager's manual adjustment to a recommendation
 * (include / exclude / re-rank / reclassify / flag-for-review) with a reason. It
 * NEVER erases the calculated run (runs are immutable), NEVER changes inventory
 * status, and NEVER changes a lead's stage/assignment/status/score or sends.
 * Feedback records an outcome signal for later review; it never retrains the
 * model. Permissions (`matching.override`, `matching.feedback.create`) are
 * enforced by the caller AND by RLS on the tables.
 */

export type MatchOverrideAction = 'include' | 'exclude' | 'rank' | 'classification' | 'review';

export interface ApplyMatchOverrideInput {
  tenantId: string;
  leadId: string;
  actorUserId: string;
  runId?: string | null;
  candidateId?: string | null;
  action: MatchOverrideAction;
  rank?: number | null;
  classification?: MatchClassification | null;
  reason: string;
  expiresAt?: string | null;
}

export interface MatchOverrideResult {
  ok: boolean;
  error?: string;
  overrideId?: string;
}

export async function applyMatchOverride(
  input: ApplyMatchOverrideInput,
  client: SupabaseClient,
): Promise<MatchOverrideResult> {
  if (!input.reason.trim()) return { ok: false, error: 'reason_required' };
  const now = new Date().toISOString();

  // Capture the candidate's calculated values as provenance (read only).
  let previous: Record<string, unknown> | null = null;
  if (input.candidateId) {
    const { data: cand } = await client
      .from('lead_match_candidates')
      .select('rank, classification, eligible')
      .eq('id', input.candidateId)
      .maybeSingle();
    if (cand) previous = cand as Record<string, unknown>;
  }

  const { data, error } = await client
    .from('lead_match_overrides')
    .insert({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      run_id: input.runId ?? null,
      candidate_id: input.candidateId ?? null,
      action: input.action,
      rank: input.rank ?? null,
      classification: input.classification ?? null,
      reason: input.reason,
      previous_value: previous,
      new_value: {
        action: input.action,
        rank: input.rank ?? null,
        classification: input.classification ?? null,
      },
      actor_id: input.actorUserId,
      applied_at: now,
      expires_at: input.expiresAt ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'override_insert_failed' };

  await writeAudit({
    action: 'MATCHING_OVERRIDE_APPLIED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'lead',
    entityId: input.leadId,
    metadata: {
      overrideId: data.id,
      action: input.action,
      candidateId: input.candidateId ?? null,
    },
  });

  return { ok: true, overrideId: data.id as string };
}

export async function removeMatchOverride(
  tenantId: string,
  leadId: string,
  overrideId: string,
  actorUserId: string,
  client: SupabaseClient,
): Promise<MatchOverrideResult> {
  const { data: live } = await client
    .from('lead_match_overrides')
    .select('id')
    .eq('id', overrideId)
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .is('removed_at', null)
    .maybeSingle();
  if (!live) return { ok: false, error: 'no_active_override' };

  const { error } = await client
    .from('lead_match_overrides')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', overrideId)
    .eq('tenant_id', tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: 'MATCHING_OVERRIDE_REMOVED',
    tenantId,
    actorUserId,
    entityType: 'lead',
    entityId: leadId,
    metadata: { overrideId },
  });

  return { ok: true, overrideId };
}

// --- Feedback ---------------------------------------------------------------

export type MatchFeedbackKind =
  | 'accepted'
  | 'rejected'
  | 'interested'
  | 'not_interested'
  | 'wrong_budget'
  | 'wrong_location'
  | 'wrong_configuration'
  | 'inventory_unavailable'
  | 'data_stale'
  | 'other';

export interface RecordMatchFeedbackInput {
  tenantId: string;
  leadId: string;
  actorUserId: string;
  runId?: string | null;
  candidateId?: string | null;
  kind: MatchFeedbackKind;
  reason?: string | null;
}

export interface MatchFeedbackResult {
  ok: boolean;
  error?: string;
  feedbackId?: string;
}

/**
 * Record match feedback. This is an outcome signal only — it never retrains the
 * model, never alters a recommendation, and never changes lead/inventory state.
 */
export async function recordMatchFeedback(
  input: RecordMatchFeedbackInput,
  client: SupabaseClient,
): Promise<MatchFeedbackResult> {
  const { data, error } = await client
    .from('lead_match_feedback')
    .insert({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      run_id: input.runId ?? null,
      candidate_id: input.candidateId ?? null,
      kind: input.kind,
      reason: input.reason ?? null,
      actor_id: input.actorUserId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'feedback_insert_failed' };

  await writeAudit({
    action: 'MATCHING_FEEDBACK_RECORDED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'lead',
    entityId: input.leadId,
    metadata: { feedbackId: data.id, kind: input.kind, candidateId: input.candidateId ?? null },
  });

  return { ok: true, feedbackId: data.id as string };
}
