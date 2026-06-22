'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  calculateLeadScore,
  isProhibitedSignal,
  type LeadScoreResult,
  type ScoreClassification,
  type SignalObservation,
  type SignalState,
  type SignalValue,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadActiveModelVersion, loadModelVersionById } from '@/lib/scoring/model-loader';
import { enqueueRecalculation } from '@/lib/scoring/recalculation';
import { applyOverride, removeOverride } from '@/lib/scoring/override-service';
import { recordObservation } from '@/lib/scoring/observations';

/**
 * Phase 6A scoring server actions.
 *
 * ABSOLUTE INVARIANTS:
 *  - The test lab runs the PURE engine only: no DB write, no lead touched.
 *  - No action changes a lead's stage/assignment/status/conversation or sends.
 *  - AI extraction only PROPOSES observations (unverified/review state); it never
 *    runs the score or mutates an effective score. Approval is a separate gated
 *    action.
 *  - Every action is permission-gated; RLS enforces tenant isolation.
 */

const SIGNAL_STATES: readonly SignalState[] = [
  'known',
  'unknown',
  'not_applicable',
  'contradictory',
  'stale',
  'unverified',
];

const CLASSIFICATIONS: readonly ScoreClassification[] = [
  'hot',
  'warm',
  'cold',
  'disqualified',
  'unscored',
  'review_required',
];

// --- Test Lab (pure, no DB write) ------------------------------------------

const testObsSchema = z.object({
  signalKey: z.string().min(1).max(120),
  value: z.string().max(500),
  valueType: z.enum(['boolean', 'number', 'string', 'string[]']).default('string'),
  state: z.enum(SIGNAL_STATES as [SignalState, ...SignalState[]]).default('known'),
});

const testLabSchema = z.object({
  modelVersionId: z.string().uuid().nullable().optional(),
  observations: z.array(testObsSchema).max(100),
});

export interface ScoringTestLabState {
  ok?: boolean;
  error?: string;
  modelVersion?: string;
  result?: LeadScoreResult;
}

function coerceValue(raw: string, valueType: string): SignalValue {
  switch (valueType) {
    case 'boolean':
      return raw.trim().toLowerCase() === 'true' || raw.trim() === '1';
    case 'number': {
      const n = Number(raw.trim());
      return Number.isFinite(n) ? n : null;
    }
    case 'string[]':
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default:
      return raw === '' ? null : raw;
  }
}

/**
 * Run the deterministic engine PURELY for a set of synthetic observations. NO DB
 * writes, NO lead touched. Gated by scoring.evaluation.use.
 */
export async function runScoringTestLab(
  input: z.infer<typeof testLabSchema>,
): Promise<ScoringTestLabState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.evaluation.use')) {
    return { error: 'You do not have permission to use the scoring test lab.' };
  }
  const parsed = testLabSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid test input.' };

  const supabase = await createSupabaseServerClient();
  const model = parsed.data.modelVersionId
    ? await loadModelVersionById(supabase, ctx.activeTenantId, parsed.data.modelVersionId)
    : await loadActiveModelVersion(supabase, ctx.activeTenantId);
  if (!model) return { error: 'No scoring model version available.' };

  // Prohibited signals are dropped (the engine also drops them defensively).
  const observations: SignalObservation[] = parsed.data.observations
    .filter((o) => !isProhibitedSignal(o.signalKey))
    .map((o) => ({
      signalKey: o.signalKey,
      value: coerceValue(o.value, o.valueType),
      state: o.state,
      observedAt: new Date().toISOString(),
    }));

  const result = calculateLeadScore({
    modelVersion: model.domain,
    observations,
    calculatedAt: new Date().toISOString(),
  });

  return { ok: true, modelVersion: model.versionLabel, result };
}

// --- Recalculate a lead's score (record-only) ------------------------------

export async function recalculateLeadScore(
  leadId: string,
): Promise<{ ok?: boolean; error?: string; classification?: string; score?: number }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.run')) {
    return { error: 'You do not have permission to run scoring.' };
  }
  if (!z.string().uuid().safeParse(leadId).success) return { error: 'Invalid lead.' };

  // Enqueue via the durable-job abstraction (sync-local drain in dev). The
  // processor calls the record-only score service; nothing else is mutated.
  await enqueueRecalculation({
    leadId,
    tenantId: ctx.activeTenantId,
    trigger: 'manual',
    actorUserId: ctx.userId,
  });

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// --- Manager override (advisory) -------------------------------------------

const overrideSchema = z.object({
  leadId: z.string().uuid(),
  score: z.coerce.number().int().nullable().optional(),
  classification: z
    .enum(CLASSIFICATIONS as [ScoreClassification, ...ScoreClassification[]])
    .nullable()
    .optional(),
  disqualifyCleared: z.boolean().optional(),
  reviewCleared: z.boolean().optional(),
  reason: z.string().min(3).max(500),
  expiresAt: z.string().nullable().optional(),
});

export async function applyScoreOverride(
  input: z.infer<typeof overrideSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.override')) {
    return { error: 'You do not have permission to override scores.' };
  }
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a reason (min 3 chars).' };

  const supabase = await createSupabaseServerClient();
  const res = await applyOverride(
    {
      tenantId: ctx.activeTenantId,
      leadId: parsed.data.leadId,
      actorUserId: ctx.userId,
      score: parsed.data.score ?? null,
      classification: parsed.data.classification ?? null,
      disqualifyCleared: parsed.data.disqualifyCleared,
      reviewCleared: parsed.data.reviewCleared,
      reason: parsed.data.reason,
      expiresAt: parsed.data.expiresAt ?? null,
    },
    supabase,
  );
  if (!res.ok) return { error: res.error ?? 'Could not apply override.' };
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

export async function removeScoreOverride(
  leadId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.override')) {
    return { error: 'You do not have permission to override scores.' };
  }
  if (!z.string().uuid().safeParse(leadId).success) return { error: 'Invalid lead.' };

  const supabase = await createSupabaseServerClient();
  const res = await removeOverride(ctx.activeTenantId, leadId, ctx.userId, supabase);
  if (!res.ok) return { error: res.error ?? 'Could not remove override.' };
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// --- AI extraction (REVIEW-ONLY proposal recorder) -------------------------

const extractionSchema = z.object({
  leadId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  proposals: z
    .array(
      z.object({
        signalKey: z.string().min(1).max(120),
        value: z.string().max(500),
        valueType: z.enum(['boolean', 'number', 'string', 'string[]']).default('string'),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Record AI-proposed observations for a lead as `lead_signal_observations` rows
 * with verification_state='unverified' and source_type='ai_extraction'. This is
 * REVIEW-ONLY: it does NOT run the score and does NOT change any effective score.
 * Approving a proposal is a separate gated action. Protected traits are rejected.
 */
export async function proposeAiExtraction(
  input: z.infer<typeof extractionSchema>,
): Promise<{ ok?: boolean; error?: string; recorded?: number; rejected?: string[] }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.run')) {
    return { error: 'You do not have permission to propose extractions.' };
  }
  const parsed = extractionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid extraction input.' };

  const supabase = await createSupabaseServerClient();
  // Confirm the lead exists for this tenant (RLS-scoped).
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', parsed.data.leadId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) return { error: 'Lead not found.' };

  let recorded = 0;
  const rejected: string[] = [];
  for (const p of parsed.data.proposals) {
    if (isProhibitedSignal(p.signalKey)) {
      rejected.push(p.signalKey);
      continue;
    }
    const res = await recordObservation(
      {
        tenantId: ctx.activeTenantId,
        leadId: parsed.data.leadId,
        signalKey: p.signalKey,
        value: coerceValue(p.value, p.valueType),
        valueType: p.valueType,
        // Proposed evidence is unverified and flagged for review — it does not
        // contribute to a score until a reviewer approves it.
        state: 'unverified',
        sourceType: 'ai_extraction',
        sourceRecordId: parsed.data.conversationId ?? null,
        verificationState: 'unverified',
        confidence: 'low',
      },
      supabase,
    );
    if (res.ok) recorded += 1;
    else rejected.push(p.signalKey);
  }

  // Audit the proposal (no score mutated).
  const { writeAudit } = await import('@/lib/audit/audit-service');
  await writeAudit({
    action: 'SCORING_EXTRACTION_PROPOSED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: parsed.data.leadId,
    metadata: { recorded, rejected, conversationId: parsed.data.conversationId ?? null },
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true, recorded, rejected };
}

/**
 * Approve a proposed (unverified) observation: flips it to verified/known so it
 * becomes eligible to contribute to the next score run. This is a SEPARATE gated
 * action; it still does not itself send anything or change lead state beyond the
 * observation row. Gated by scoring.override (a reviewer-level capability).
 */
export async function approveExtraction(
  observationId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.override')) {
    return { error: 'You do not have permission to approve extractions.' };
  }
  if (!z.string().uuid().safeParse(observationId).success) return { error: 'Invalid observation.' };

  const supabase = await createSupabaseServerClient();
  const { data: obs } = await supabase
    .from('lead_signal_observations')
    .select('id, lead_id, signal_key')
    .eq('id', observationId)
    .is('superseded_at', null)
    .maybeSingle();
  if (!obs) return { error: 'Observation not found.' };
  if (isProhibitedSignal(obs.signal_key as string)) return { error: 'Prohibited signal.' };

  const { error } = await supabase
    .from('lead_signal_observations')
    .update({ verification_state: 'verified', state: 'known' })
    .eq('id', observationId);
  if (error) return { error: 'Could not approve.' };

  await import('@/lib/audit/audit-service').then(({ writeAudit }) =>
    writeAudit({
      action: 'SCORING_EXTRACTION_APPROVED',
      tenantId: ctx.activeTenantId,
      actorUserId: ctx.userId,
      entityType: 'lead',
      entityId: obs.lead_id as string,
      metadata: { observationId },
    }),
  );

  revalidatePath(`/leads/${obs.lead_id as string}`);
  return { ok: true };
}
