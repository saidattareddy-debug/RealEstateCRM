'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  assertNoProhibitedMatchInputs,
  isProhibitedSignal,
  type MatchRule,
  type MatchRuleGroup,
  type MatchRuleKind,
  type MatchRuleOperator,
  type MatchThresholds,
  type MissingHandling,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 6B — matching model lifecycle + rule editing (configuration).
 *
 * INVARIANTS:
 *  - You CANNOT edit an active version's rules (DB trigger enforces; we also
 *    refuse and require drafting a new version).
 *  - Activating retires the prior active version (one active per model) and is
 *    audited as a security event.
 *  - A rule can never target a prohibited (protected/sensitive) signal or
 *    candidate field (DB CHECK + domain guard).
 *  - Nothing here matches a lead or changes lead/inventory state.
 */

const GROUPS: readonly MatchRuleGroup[] = [
  'budget',
  'configuration',
  'location',
  'property_type',
  'area',
  'possession',
  'amenities',
  'lifestyle',
  'financing',
  'inventory',
  'freshness',
  'exclusions',
];
const KINDS: readonly MatchRuleKind[] = ['hard', 'soft', 'informational', 'review_required'];
const OPERATORS: readonly MatchRuleOperator[] = [
  'boolean_true',
  'enum_in',
  'numeric_range',
  'budget_overlap',
  'area_overlap',
  'date_window_overlap',
  'distance_threshold',
  'set_intersection',
  'required_feature',
  'preferred_feature',
  'missing_value',
  'exclusion',
  'review_required',
  'freshness',
];
const MISSING: readonly MissingHandling[] = ['zero', 'fail', 'review', 'skip'];

type ActionResult = { ok?: boolean; error?: string; id?: string };

async function authManage(): Promise<
  { ctx: Awaited<ReturnType<typeof getAppContext>>; tenantId: string } | { error: string }
> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.models.manage')) {
    return { error: 'You do not have permission to manage matching models.' };
  }
  return { ctx, tenantId: ctx.activeTenantId };
}

// --- Create a draft version (optionally a clone of an existing version) ------

const cloneSchema = z.object({
  modelId: z.string().uuid(),
  sourceVersionId: z.string().uuid().nullable().optional(),
  version: z.string().min(1).max(40),
});

export async function createDraftMatchVersion(
  input: z.infer<typeof cloneSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = cloneSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a version label.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const sourceId = parsed.data.sourceVersionId;
  let seed: Record<string, unknown> = {};
  if (sourceId) {
    const { data: src } = await supabase
      .from('matching_model_versions')
      .select(
        'scale_min, scale_max, thresholds, group_caps, group_minimums, freshness_window_days, preference_signals',
      )
      .eq('id', sourceId)
      .maybeSingle();
    if (src) seed = src as Record<string, unknown>;
  }

  const { data: ver, error } = await supabase
    .from('matching_model_versions')
    .insert({
      tenant_id: tenantId,
      model_id: parsed.data.modelId,
      version: parsed.data.version,
      status: 'draft',
      created_by: ctx.userId,
      ...(sourceId
        ? {
            scale_min: seed.scale_min,
            scale_max: seed.scale_max,
            thresholds: seed.thresholds,
            group_caps: seed.group_caps,
            group_minimums: seed.group_minimums,
            freshness_window_days: seed.freshness_window_days,
            preference_signals: seed.preference_signals,
          }
        : {}),
    })
    .select('id')
    .single();
  if (error || !ver) return { error: error?.message ?? 'Could not create draft.' };
  const newVersionId = ver.id as string;

  if (sourceId) {
    const { data: rules } = await supabase
      .from('matching_rules')
      .select(
        'group_key, kind, operator, signal_key, candidate_field, expected, weight, max_contribution, missing_handling, priority, explanation_template, reason, effective_at, expires_at, project_id',
      )
      .eq('model_version_id', sourceId);
    if (rules && rules.length > 0) {
      const rows = (rules as Record<string, unknown>[]).map((r) => ({
        ...r,
        tenant_id: tenantId,
        model_version_id: newVersionId,
      }));
      await supabase.from('matching_rules').insert(rows);
    }
  }

  await writeAudit({
    action: 'MATCHING_VERSION_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: newVersionId,
    metadata: { modelId: parsed.data.modelId, clonedFrom: sourceId ?? null },
  });

  revalidatePath('/settings/matching');
  revalidatePath(`/settings/matching/${newVersionId}`);
  return { ok: true, id: newVersionId };
}

// --- Lifecycle transitions --------------------------------------------------

async function loadVersionStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  versionId: string,
): Promise<{ status: string; model_id: string } | null> {
  const { data } = await supabase
    .from('matching_model_versions')
    .select('status, model_id')
    .eq('id', versionId)
    .maybeSingle();
  return data ? { status: data.status as string, model_id: data.model_id as string } : null;
}

export async function submitMatchVersionForApproval(versionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status !== 'draft') return { error: 'Only a draft can be submitted.' };

  const { error } = await supabase
    .from('matching_model_versions')
    .update({ status: 'pending_approval' })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'MATCHING_MODEL_SUBMITTED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/matching');
  return { ok: true };
}

export async function approveMatchVersion(versionId: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'matching.models.approve')) {
    return { error: 'You do not have permission to approve matching models.' };
  }
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status !== 'pending_approval') {
    return { error: 'Only a pending version can be approved.' };
  }
  const { error } = await supabase
    .from('matching_model_versions')
    .update({ approved_by: ctx.userId })
    .eq('id', versionId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'MATCHING_MODEL_APPROVED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/matching');
  return { ok: true };
}

export async function activateMatchVersion(versionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v) return { error: 'Version not found.' };
  if (v.status === 'active') return { error: 'Already active.' };
  if (v.status === 'retired') return { error: 'A retired version cannot be reactivated.' };

  // Retire the current active version of this model (one active per model).
  await supabase
    .from('matching_model_versions')
    .update({ status: 'retired' })
    .eq('tenant_id', tenantId)
    .eq('model_id', v.model_id)
    .eq('status', 'active');

  const { error } = await supabase
    .from('matching_model_versions')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'MATCHING_MODEL_ACTIVATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: versionId,
    metadata: { modelId: v.model_id },
  });
  revalidatePath('/settings/matching');
  return { ok: true };
}

export async function retireMatchVersion(versionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status === 'retired') return { error: 'Version not found or already retired.' };

  const { error } = await supabase
    .from('matching_model_versions')
    .update({ status: 'retired' })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'MATCHING_MODEL_RETIRED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/matching');
  return { ok: true };
}

// --- Draft rule editing (JSON) ----------------------------------------------

const ruleSchema = z.object({
  group: z.enum(GROUPS as [MatchRuleGroup, ...MatchRuleGroup[]]),
  kind: z.enum(KINDS as [MatchRuleKind, ...MatchRuleKind[]]).default('soft'),
  operator: z.enum(OPERATORS as [MatchRuleOperator, ...MatchRuleOperator[]]),
  signalKey: z.string().min(1).max(120),
  candidateField: z.string().min(1).max(120),
  expected: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().default(0),
  maxContribution: z.number().default(0),
  missingHandling: z.enum(MISSING as [MissingHandling, ...MissingHandling[]]).default('zero'),
  priority: z.number().int().default(100),
  explanationTemplate: z.string().default(''),
  reason: z.string().optional(),
});

const replaceRulesSchema = z.object({
  versionId: z.string().uuid(),
  thresholds: z
    .object({
      excellent: z.number(),
      good: z.number(),
      possible: z.number(),
      weak: z.number(),
    })
    .optional(),
  freshnessWindowDays: z.number().int().min(0).optional(),
  preferenceSignals: z.array(z.string()).optional(),
  rules: z.array(ruleSchema).max(200),
});

function validateMatchThresholds(t: MatchThresholds): string | null {
  if (!(t.excellent >= t.good && t.good >= t.possible && t.possible >= t.weak)) {
    return 'thresholds must satisfy excellent ≥ good ≥ possible ≥ weak';
  }
  return null;
}

/**
 * Replace ALL rules on a DRAFT version (and optionally thresholds / freshness /
 * preference signals). The active-version trigger forbids editing active rules;
 * we also refuse here. Prohibited signals/fields are rejected before any write.
 */
export async function replaceDraftMatchRules(
  input: z.infer<typeof replaceRulesSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = replaceRulesSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid rule payload.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data: version } = await supabase
    .from('matching_model_versions')
    .select('status')
    .eq('id', parsed.data.versionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!version) return { error: 'Version not found.' };
  if (version.status !== 'draft') {
    return { error: 'Only a draft version can be edited. Create a new draft to change rules.' };
  }

  // Reject prohibited signals/fields before writing anything.
  for (const r of parsed.data.rules) {
    if (isProhibitedSignal(r.signalKey) || isProhibitedSignal(r.candidateField)) {
      return {
        error: `Prohibited input "${r.signalKey}/${r.candidateField}" cannot be a match rule.`,
      };
    }
  }
  const domainRules: MatchRule[] = parsed.data.rules.map((r, i) => ({
    id: `tmp-${i}`,
    group: r.group,
    kind: r.kind,
    operator: r.operator,
    signalKey: r.signalKey,
    candidateField: r.candidateField,
    expected: r.expected as MatchRule['expected'],
    weight: r.weight,
    maxContribution: r.maxContribution,
    missingHandling: r.missingHandling,
    priority: r.priority,
    explanationTemplate: r.explanationTemplate,
    reason: r.reason,
  }));
  try {
    assertNoProhibitedMatchInputs(domainRules);
  } catch {
    return { error: 'Prohibited input in rules.' };
  }

  if (parsed.data.thresholds) {
    const err = validateMatchThresholds(parsed.data.thresholds as MatchThresholds);
    if (err) return { error: `Invalid thresholds: ${err}` };
  }

  await supabase
    .from('matching_model_versions')
    .update({
      ...(parsed.data.thresholds ? { thresholds: parsed.data.thresholds } : {}),
      ...(parsed.data.freshnessWindowDays !== undefined
        ? { freshness_window_days: parsed.data.freshnessWindowDays }
        : {}),
      ...(parsed.data.preferenceSignals !== undefined
        ? { preference_signals: parsed.data.preferenceSignals }
        : {}),
    })
    .eq('id', parsed.data.versionId)
    .eq('tenant_id', tenantId);

  await supabase.from('matching_rules').delete().eq('model_version_id', parsed.data.versionId);
  if (parsed.data.rules.length > 0) {
    const rows = parsed.data.rules.map((r) => ({
      tenant_id: tenantId,
      model_version_id: parsed.data.versionId,
      group_key: r.group,
      kind: r.kind,
      operator: r.operator,
      signal_key: r.signalKey,
      candidate_field: r.candidateField,
      expected: r.expected ?? {},
      weight: r.weight,
      max_contribution: r.maxContribution,
      missing_handling: r.missingHandling,
      priority: r.priority,
      explanation_template: r.explanationTemplate,
      reason: r.reason ?? null,
    }));
    const { error } = await supabase.from('matching_rules').insert(rows);
    if (error) return { error: error.message };
  }

  await writeAudit({
    action: 'MATCHING_VERSION_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'matching_model_version',
    entityId: parsed.data.versionId,
    metadata: { rulesUpdated: parsed.data.rules.length },
  });

  revalidatePath(`/settings/matching/${parsed.data.versionId}`);
  revalidatePath('/settings/matching');
  return { ok: true };
}
