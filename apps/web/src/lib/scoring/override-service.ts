import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoreClassification } from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 6A — manager score overrides (ADVISORY).
 *
 * An override records a manager's manual effective score/classification with a
 * reason + expiry. It NEVER erases the calculated run (those are immutable) and
 * NEVER changes a lead's stage/assignment/status/conversation. Applying a new
 * override supersedes the prior live one (sets `removed_at`); expired overrides
 * are ignored by the domain `effectiveScore`. Permission `scoring.override` is
 * enforced by the caller (and by RLS on the table).
 */

export interface ApplyOverrideInput {
  tenantId: string;
  leadId: string;
  actorUserId: string;
  score?: number | null;
  classification?: ScoreClassification | null;
  disqualifyCleared?: boolean;
  reviewCleared?: boolean;
  reason: string;
  expiresAt?: string | null;
}

export interface OverrideResult {
  ok: boolean;
  error?: string;
  overrideId?: string;
}

export async function applyOverride(
  input: ApplyOverrideInput,
  client?: SupabaseClient,
): Promise<OverrideResult> {
  if (!input.reason.trim()) return { ok: false, error: 'reason_required' };
  const supabase = client ?? createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Read the latest calculated run as the "previous value" provenance — read only.
  const { data: latestRun } = await supabase
    .from('lead_score_runs')
    .select('id, score, classification')
    .eq('tenant_id', input.tenantId)
    .eq('lead_id', input.leadId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Supersede the prior live override (history preserved; never deleted).
  await supabase
    .from('lead_score_overrides')
    .update({ removed_at: now })
    .eq('tenant_id', input.tenantId)
    .eq('lead_id', input.leadId)
    .is('removed_at', null);

  const { data, error } = await supabase
    .from('lead_score_overrides')
    .insert({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      score: input.score ?? null,
      classification: input.classification ?? null,
      disqualify_cleared: input.disqualifyCleared ?? false,
      review_cleared: input.reviewCleared ?? false,
      reason: input.reason,
      previous_value: latestRun
        ? { score: latestRun.score, classification: latestRun.classification }
        : null,
      new_value: { score: input.score ?? null, classification: input.classification ?? null },
      actor_id: input.actorUserId,
      applied_at: now,
      expires_at: input.expiresAt ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'override_insert_failed' };

  await writeAudit({
    action: 'SCORING_OVERRIDE_APPLIED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'lead',
    entityId: input.leadId,
    metadata: {
      overrideId: data.id,
      score: input.score ?? null,
      classification: input.classification ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });

  return { ok: true, overrideId: data.id as string };
}

export async function removeOverride(
  tenantId: string,
  leadId: string,
  actorUserId: string,
  client?: SupabaseClient,
): Promise<OverrideResult> {
  const supabase = client ?? createSupabaseAdminClient();
  const { data: live } = await supabase
    .from('lead_score_overrides')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .is('removed_at', null)
    .maybeSingle();
  if (!live) return { ok: false, error: 'no_active_override' };

  const { error } = await supabase
    .from('lead_score_overrides')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', live.id as string)
    .eq('tenant_id', tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: 'SCORING_OVERRIDE_REMOVED',
    tenantId,
    actorUserId,
    entityType: 'lead',
    entityId: leadId,
    metadata: { overrideId: live.id },
  });

  return { ok: true, overrideId: live.id as string };
}
