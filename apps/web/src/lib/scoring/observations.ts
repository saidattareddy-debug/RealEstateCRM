import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProhibitedSignal, type SignalState, type SignalValue } from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 6A — lead signal observation recorder (RECORD-ONLY).
 *
 * Records a `lead_signal_observations` row for a lead. This NEVER scores a lead,
 * never changes a lead's stage/assignment/status/conversation, and never sends.
 * Fairness: a prohibited (protected/sensitive) signal key is rejected outright —
 * it can never become a scoring input. Recording a new observation of the same
 * signal supersedes the prior live observation (sets `superseded_at`) so the
 * score engine only sees the latest value; history is preserved (never deleted).
 */

export interface RecordObservationInput {
  tenantId: string;
  leadId: string;
  signalKey: string;
  value: SignalValue;
  valueType?: string;
  state?: SignalState;
  projectId?: string | null;
  sourceType?: string;
  sourceRecordId?: string | null;
  observedAt?: string;
  verificationState?: string;
  confidence?: 'high' | 'medium' | 'low';
  expiresAt?: string | null;
  correlationId?: string | null;
}

export interface RecordObservationResult {
  ok: boolean;
  observationId?: string;
  error?: string;
}

/**
 * Record (or supersede) a single observation. Uses the service-role client so it
 * can write the observation + supersede the prior row in one server step; every
 * caller MUST have already enforced tenant + permission.
 */
export async function recordObservation(
  input: RecordObservationInput,
  client?: SupabaseClient,
): Promise<RecordObservationResult> {
  if (isProhibitedSignal(input.signalKey)) {
    // Hard fairness boundary — a protected/sensitive trait is never recorded.
    return { ok: false, error: 'prohibited_signal' };
  }

  const supabase = client ?? createSupabaseAdminClient();
  const observedAt = input.observedAt ?? new Date().toISOString();

  // Supersede the prior live observation of this signal for this lead so the
  // score engine reads only the latest value. History rows are never deleted.
  const { error: supersedeError } = await supabase
    .from('lead_signal_observations')
    .update({ superseded_at: observedAt })
    .eq('tenant_id', input.tenantId)
    .eq('lead_id', input.leadId)
    .eq('signal_key', input.signalKey)
    .is('superseded_at', null);
  if (supersedeError) return { ok: false, error: supersedeError.message };

  const { data, error } = await supabase
    .from('lead_signal_observations')
    .insert({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      project_id: input.projectId ?? null,
      signal_key: input.signalKey,
      value: input.value,
      value_type: input.valueType ?? inferValueType(input.value),
      state: input.state ?? 'known',
      source_type: input.sourceType ?? 'system',
      source_record_id: input.sourceRecordId ?? null,
      observed_at: observedAt,
      verification_state: input.verificationState ?? 'unverified',
      confidence: input.confidence ?? 'medium',
      expires_at: input.expiresAt ?? null,
      correlation_id: input.correlationId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' };

  return { ok: true, observationId: data.id as string };
}

function inferValueType(value: SignalValue): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'string[]';
  return 'string';
}
