import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateExtractionProposal,
  buildExtractionIdempotencyKey,
  type ExtractionProposalInput,
} from '@re/domain';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 6B — AI preference extraction (REVIEW-ONLY, structured, idempotent).
 *
 * AI may PROPOSE structured lead preferences from visible conversation content.
 * Every proposal is recorded in `lead_match_preference_extractions` with full
 * provenance (source messages, span, prompt version, model config, confidence,
 * correlation id) in a `pending` review state with a deterministic idempotency
 * key (a duplicate proposal is a no-op). A pending or rejected extraction NEVER
 * reaches the matching engine and NEVER mutates `lead_preferences`. Applying an
 * approved extraction to lead preferences is a separate, explicitly-approved
 * action — this service only proposes and reviews.
 */

export interface ExtractionProposal extends ExtractionProposalInput {
  sourceMessageIds?: string[];
  sourceSpan?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface ProposeExtractionInput {
  tenantId: string;
  leadId: string;
  conversationId?: string | null;
  promptVersion: string;
  modelConfig: string;
  correlationId?: string | null;
  proposals: ExtractionProposal[];
}

export interface ProposeExtractionResult {
  ok: boolean;
  error?: string;
  recorded: number;
  rejected: { signalKey: string; reason: string }[];
}

export async function proposeExtractions(
  input: ProposeExtractionInput,
  client: SupabaseClient,
  actorUserId: string,
): Promise<ProposeExtractionResult> {
  const rejected: { signalKey: string; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const p of input.proposals) {
    const v = validateExtractionProposal(p);
    if (!v.ok) {
      rejected.push({ signalKey: p.signalKey, reason: v.reason ?? 'invalid' });
      continue;
    }
    const valueStr = Array.isArray(p.value) ? p.value.join(',') : String(p.value);
    rows.push({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      conversation_id: input.conversationId ?? null,
      signal_key: p.signalKey,
      value: p.value as unknown,
      value_type: p.valueType ?? 'string',
      source_message_ids: p.sourceMessageIds ?? [],
      source_span: p.sourceSpan ?? null,
      prompt_version: input.promptVersion,
      model_config: input.modelConfig,
      confidence: p.confidence ?? 'medium',
      idempotency_key: buildExtractionIdempotencyKey({
        tenantId: input.tenantId,
        leadId: input.leadId,
        signalKey: p.signalKey,
        promptVersion: input.promptVersion,
        modelConfig: input.modelConfig,
        value: valueStr,
      }),
      review_state: 'pending',
      correlation_id: input.correlationId ?? null,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: 'no_valid_proposals', recorded: 0, rejected };
  }

  // Idempotent upsert: a duplicate (tenant, idempotency_key) is ignored.
  const { data, error } = await client
    .from('lead_match_preference_extractions')
    .upsert(rows, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, error: 'insert_failed', recorded: 0, rejected };

  const recorded = data?.length ?? 0;
  await writeAudit({
    action: 'MATCHING_EXTRACTION_PROPOSED',
    tenantId: input.tenantId,
    actorUserId,
    entityType: 'lead',
    entityId: input.leadId,
    metadata: {
      recorded,
      rejected: rejected.map((r) => r.signalKey),
      promptVersion: input.promptVersion,
    },
  });
  return { ok: true, recorded, rejected };
}

/** Approve or reject a pending extraction. Approval does NOT itself mutate
 * lead preferences or run a match — it only records the review decision. */
export async function reviewExtraction(
  input: { tenantId: string; extractionId: string; decision: 'approved' | 'rejected' },
  client: SupabaseClient,
  actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await client
    .from('lead_match_preference_extractions')
    .update({
      review_state: input.decision,
      reviewed_by: actorUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.extractionId)
    .eq('tenant_id', input.tenantId)
    .eq('review_state', 'pending');
  if (error) return { ok: false, error: 'review_failed' };
  await writeAudit({
    action:
      input.decision === 'approved'
        ? 'MATCHING_EXTRACTION_APPROVED'
        : 'MATCHING_EXTRACTION_REJECTED',
    tenantId: input.tenantId,
    actorUserId,
    entityType: 'lead',
    entityId: input.extractionId,
    metadata: { decision: input.decision },
  });
  return { ok: true };
}
