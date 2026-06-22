'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  calculateProjectMatches,
  isProhibitedSignal,
  type LeadSnapshot,
  type MatchCandidate,
  type MatchClassification,
  type MatchRunResult,
  type PreferenceValue,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  loadActiveMatchModelVersion,
  loadMatchModelVersionById,
} from '@/lib/matching/model-loader';
import { enqueueMatchRecalculation } from '@/lib/matching/recalculation';
import {
  applyMatchOverride,
  removeMatchOverride,
  recordMatchFeedback,
  type MatchFeedbackKind,
  type MatchOverrideAction,
} from '@/lib/matching/override-service';
import { proposeExtractions, reviewExtraction } from '@/lib/matching/extraction-service';

/**
 * Phase 6B matching server actions.
 *
 * ABSOLUTE INVARIANTS:
 *  - The test lab runs the PURE engine only: no DB write, no lead/project/unit
 *    touched.
 *  - No action assigns a lead, changes a stage/status/score, reserves inventory,
 *    or sends anything. Matching is ADVISORY.
 *  - AI preference extraction only PROPOSES structured preferences into a review
 *    state; it never runs a match or mutates lead preferences. Approval is a
 *    separate gated action.
 *  - Every action is permission-gated; RLS enforces tenant + visibility.
 */

const CLASSIFICATIONS: readonly MatchClassification[] = [
  'excellent',
  'good',
  'possible',
  'weak',
  'ineligible',
  'review_required',
  'insufficient_information',
];

const OVERRIDE_ACTIONS: readonly MatchOverrideAction[] = [
  'include',
  'exclude',
  'rank',
  'classification',
  'review',
];

const FEEDBACK_KINDS: readonly MatchFeedbackKind[] = [
  'accepted',
  'rejected',
  'interested',
  'not_interested',
  'wrong_budget',
  'wrong_location',
  'wrong_configuration',
  'inventory_unavailable',
  'data_stale',
  'other',
];

// --- Test Lab (pure, no DB write) ------------------------------------------

const prefSchema = z.object({
  signalKey: z.string().min(1).max(120),
  value: z.string().max(500),
  valueType: z.enum(['boolean', 'number', 'string', 'string[]', 'range']).default('string'),
});

const testCandidateSchema = z.object({
  label: z.string().max(120).optional(),
  level: z.enum(['project', 'configuration', 'unit']).default('project'),
  locality: z.string().max(120).optional(),
  category: z.string().max(60).optional(),
  amenities: z.string().max(500).optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  unitPrice: z.coerce.number().optional(),
  unitStatus: z.string().max(40).optional(),
  /** Days since the unit was last verified (synthetic freshness). */
  verifiedDaysAgo: z.coerce.number().optional(),
  excludedByLead: z.boolean().default(false),
});

const testLabSchema = z.object({
  modelVersionId: z.string().uuid().nullable().optional(),
  preferences: z.array(prefSchema).max(50),
  candidates: z.array(testCandidateSchema).min(1).max(50),
});

export interface MatchingTestLabState {
  ok?: boolean;
  error?: string;
  modelVersion?: string;
  result?: MatchRunResult;
}

function coercePref(raw: string, valueType: string): PreferenceValue {
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
    case 'range': {
      const [lo, hi] = raw.split('-').map((s) => Number(s.trim()));
      return {
        min: Number.isFinite(lo) ? lo : undefined,
        max: Number.isFinite(hi) ? hi : undefined,
      };
    }
    default:
      return raw === '' ? null : raw;
  }
}

/**
 * Run the deterministic matching engine PURELY for synthetic preferences +
 * candidates. NO DB writes, NO lead/project/unit touched. Gated by
 * matching.evaluation.use.
 */
export async function runMatchingTestLab(
  input: z.infer<typeof testLabSchema>,
): Promise<MatchingTestLabState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.evaluation.use')) {
    return { error: 'You do not have permission to use the matching test lab.' };
  }
  const parsed = testLabSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid test input.' };

  const supabase = await createSupabaseServerClient();
  const model = parsed.data.modelVersionId
    ? await loadMatchModelVersionById(supabase, ctx.activeTenantId, parsed.data.modelVersionId)
    : await loadActiveMatchModelVersion(supabase, ctx.activeTenantId);
  if (!model) return { error: 'No matching model version available.' };

  const preferences: Record<string, PreferenceValue> = {};
  for (const p of parsed.data.preferences) {
    if (isProhibitedSignal(p.signalKey)) continue;
    preferences[p.signalKey] = coercePref(p.value, p.valueType);
  }
  const budget = preferences.budget as { min?: number; max?: number } | undefined;
  const snapshot: LeadSnapshot = {
    preferences,
    budgetMin: budget?.min,
    budgetMax: budget?.max,
  };

  const nowMs = Date.now();
  const candidates: MatchCandidate[] = parsed.data.candidates.map((c, i) => {
    const amenities = (c.amenities ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const verifiedAt =
      c.verifiedDaysAgo !== undefined
        ? new Date(nowMs - c.verifiedDaysAgo * 86_400_000).toISOString()
        : undefined;
    return {
      id: `synthetic:${i}`,
      level: c.level,
      tenantId: ctx.activeTenantId!,
      projectId: `synthetic-project-${i}`,
      inTenant: true,
      projectActive: true,
      projectApproved: true,
      projectVisible: true,
      saleApplicable: true,
      propertyCategoryAllowed: true,
      excludedByLead: c.excludedByLead,
      fields: {
        locality: c.locality,
        category: c.category,
        propertyType: c.category,
        amenities,
        price: c.priceMin,
      },
      advertisedMin: c.priceMin,
      advertisedMax: c.priceMax,
      unitPrice: c.unitPrice,
      unitStatus: c.level === 'unit' ? (c.unitStatus ?? 'available') : undefined,
      unitVerifiedAt: c.level === 'unit' ? verifiedAt : undefined,
    };
  });

  const result = calculateProjectMatches({
    modelVersion: model.domain,
    leadSnapshot: snapshot,
    candidates,
    calculatedAt: new Date().toISOString(),
  });

  return { ok: true, modelVersion: model.versionLabel, result };
}

// --- Recalculate a lead's matches (advisory, record-only) ------------------

export async function recalculateLeadMatch(
  leadId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.run')) {
    return { error: 'You do not have permission to run matching.' };
  }
  if (!z.string().uuid().safeParse(leadId).success) return { error: 'Invalid lead.' };

  await enqueueMatchRecalculation({
    leadId,
    tenantId: ctx.activeTenantId,
    trigger: 'manual',
    actorUserId: ctx.userId,
  });

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// --- Override (advisory) ----------------------------------------------------

const overrideSchema = z.object({
  leadId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  candidateId: z.string().uuid().nullable().optional(),
  action: z.enum(OVERRIDE_ACTIONS as [MatchOverrideAction, ...MatchOverrideAction[]]),
  rank: z.coerce.number().int().nullable().optional(),
  classification: z
    .enum(CLASSIFICATIONS as [MatchClassification, ...MatchClassification[]])
    .nullable()
    .optional(),
  reason: z.string().min(3).max(500),
  expiresAt: z.string().nullable().optional(),
});

export async function applyLeadMatchOverride(
  input: z.infer<typeof overrideSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.override')) {
    return { error: 'You do not have permission to override matches.' };
  }
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a reason (min 3 chars).' };

  const supabase = await createSupabaseServerClient();
  const res = await applyMatchOverride(
    {
      tenantId: ctx.activeTenantId,
      leadId: parsed.data.leadId,
      actorUserId: ctx.userId,
      runId: parsed.data.runId ?? null,
      candidateId: parsed.data.candidateId ?? null,
      action: parsed.data.action,
      rank: parsed.data.rank ?? null,
      classification: parsed.data.classification ?? null,
      reason: parsed.data.reason,
      expiresAt: parsed.data.expiresAt ?? null,
    },
    supabase,
  );
  if (!res.ok) return { error: res.error ?? 'Could not apply override.' };
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

export async function removeLeadMatchOverride(
  leadId: string,
  overrideId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.override')) {
    return { error: 'You do not have permission to override matches.' };
  }
  if (
    !z.string().uuid().safeParse(leadId).success ||
    !z.string().uuid().safeParse(overrideId).success
  ) {
    return { error: 'Invalid request.' };
  }
  const supabase = await createSupabaseServerClient();
  const res = await removeMatchOverride(
    ctx.activeTenantId,
    leadId,
    overrideId,
    ctx.userId,
    supabase,
  );
  if (!res.ok) return { error: res.error ?? 'Could not remove override.' };
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// --- Feedback ---------------------------------------------------------------

const feedbackSchema = z.object({
  leadId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  candidateId: z.string().uuid().nullable().optional(),
  kind: z.enum(FEEDBACK_KINDS as [MatchFeedbackKind, ...MatchFeedbackKind[]]),
  reason: z.string().max(500).nullable().optional(),
});

export async function submitLeadMatchFeedback(
  input: z.infer<typeof feedbackSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.feedback.create')) {
    return { error: 'You do not have permission to record match feedback.' };
  }
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid feedback.' };

  const supabase = await createSupabaseServerClient();
  const res = await recordMatchFeedback(
    {
      tenantId: ctx.activeTenantId,
      leadId: parsed.data.leadId,
      actorUserId: ctx.userId,
      runId: parsed.data.runId ?? null,
      candidateId: parsed.data.candidateId ?? null,
      kind: parsed.data.kind,
      reason: parsed.data.reason ?? null,
    },
    supabase,
  );
  if (!res.ok) return { error: res.error ?? 'Could not record feedback.' };
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

// --- AI preference extraction (REVIEW-ONLY proposal) ------------------------

const extractionSchema = z.object({
  leadId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  promptVersion: z.string().min(1).max(80).default('match-extract-v1'),
  modelConfig: z.string().min(1).max(120).default('mock'),
  proposals: z
    .array(
      z.object({
        signalKey: z.string().min(1).max(120),
        value: z.string().max(500),
        valueType: z.enum(['boolean', 'number', 'string', 'string[]', 'range']).default('string'),
        sourceMessageIds: z.array(z.string().uuid()).max(20).optional(),
        sourceSpan: z.string().max(500).optional(),
        confidence: z.enum(['high', 'medium', 'low']).optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Record AI-proposed preferences in the structured, provenance-bearing
 * `lead_match_preference_extractions` table (review state `pending`, idempotent).
 * This does NOT call runLeadMatch, does NOT mutate `lead_preferences`, never
 * infers a protected trait, and never affects ranking. Approval/rejection is a
 * separate gated action; applying an approved extraction to preferences is a
 * further, explicitly-approved step. Gated by `matching.override`.
 */
export async function proposeMatchPreferenceExtraction(
  input: z.infer<typeof extractionSchema>,
): Promise<{ ok?: boolean; error?: string; recorded?: number; rejected?: string[] }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.override')) {
    return { error: 'You do not have permission to propose extractions.' };
  }
  const parsed = extractionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid extraction input.' };

  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', parsed.data.leadId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) return { error: 'Lead not found.' };

  const res = await proposeExtractions(
    {
      tenantId: ctx.activeTenantId,
      leadId: parsed.data.leadId,
      conversationId: parsed.data.conversationId ?? null,
      promptVersion: parsed.data.promptVersion,
      modelConfig: parsed.data.modelConfig,
      correlationId: ctx.userId,
      proposals: parsed.data.proposals,
    },
    supabase,
    ctx.userId,
  );
  if (!res.ok)
    return {
      error: res.error ?? 'Could not record proposal.',
      rejected: res.rejected.map((r) => r.signalKey),
    };

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true, recorded: res.recorded, rejected: res.rejected.map((r) => r.signalKey) };
}

/** Approve or reject a pending AI extraction. Does NOT mutate preferences or run a match. */
export async function reviewMatchPreferenceExtraction(
  extractionId: string,
  decision: 'approved' | 'rejected',
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.override')) {
    return { error: 'You do not have permission to review extractions.' };
  }
  if (!z.string().uuid().safeParse(extractionId).success) return { error: 'Invalid request.' };
  const supabase = await createSupabaseServerClient();
  const res = await reviewExtraction(
    { tenantId: ctx.activeTenantId, extractionId, decision },
    supabase,
    ctx.userId,
  );
  if (!res.ok) return { error: res.error ?? 'Could not review extraction.' };
  return { ok: true };
}
