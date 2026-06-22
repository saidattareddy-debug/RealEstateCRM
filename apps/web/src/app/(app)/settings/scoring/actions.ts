'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  assertNoProhibitedSignals,
  validateThresholds,
  isProhibitedSignal,
  type RuleGroup,
  type RuleOperator,
  type ScoringRule,
  type ScoringThresholds,
  type UnknownHandling,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 6A — scoring model lifecycle + rule editing (configuration).
 *
 * INVARIANTS:
 *  - You CANNOT edit an active version's rules (DB trigger enforces; we also
 *    refuse and require drafting a new version).
 *  - Activating retires the prior active version (one active per model) and is
 *    audited as a security event.
 *  - A rule can never target a prohibited (protected/sensitive) signal.
 *  - Nothing here scores a lead or changes lead state.
 */

const GROUPS: readonly RuleGroup[] = [
  'intent',
  'fit',
  'engagement',
  'source',
  'freshness',
  'qualification',
  'negative',
  'disqualification',
];
const OPERATORS: readonly RuleOperator[] = [
  'boolean_true',
  'numeric_range',
  'enum_in',
  'date_recency',
  'count_gte',
  'completion',
  'exact_match',
  'set_intersection',
  'missing_value',
  'disqualify',
  'review_required',
];

type ActionResult = { ok?: boolean; error?: string; id?: string };

async function authManage(): Promise<
  { ctx: Awaited<ReturnType<typeof getAppContext>>; tenantId: string } | { error: string }
> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.models.manage')) {
    return { error: 'You do not have permission to manage scoring models.' };
  }
  return { ctx, tenantId: ctx.activeTenantId };
}

// --- Create a draft version (clone of an existing version's rules) ----------

const cloneSchema = z.object({
  modelId: z.string().uuid(),
  sourceVersionId: z.string().uuid().nullable().optional(),
  version: z.string().min(1).max(40),
});

export async function createDraftVersion(
  input: z.infer<typeof cloneSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = cloneSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a version label.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  // Read the source version's config (RLS-scoped) to seed the new draft.
  const sourceId = parsed.data.sourceVersionId;
  let seed: Record<string, unknown> = {};
  if (sourceId) {
    const { data: src } = await supabase
      .from('scoring_model_versions')
      .select(
        'scale_min, scale_max, thresholds, group_caps, group_minimums, total_min, total_max, qualification_signals',
      )
      .eq('id', sourceId)
      .maybeSingle();
    if (src) seed = src as Record<string, unknown>;
  }

  const { data: ver, error } = await supabase
    .from('scoring_model_versions')
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
            total_min: seed.total_min,
            total_max: seed.total_max,
            qualification_signals: seed.qualification_signals,
          }
        : {}),
    })
    .select('id')
    .single();
  if (error || !ver) return { error: error?.message ?? 'Could not create draft.' };
  const newVersionId = ver.id as string;

  // Clone rules from the source version into the new draft.
  if (sourceId) {
    const { data: rules } = await supabase
      .from('scoring_rules')
      .select(
        'group_key, signal_key, operator, expected, weight, max_contribution, min_contribution, required_evidence, effective_at, expires_at, priority, stop_processing, explanation_template, unknown_handling, reason, project_id',
      )
      .eq('model_version_id', sourceId);
    if (rules && rules.length > 0) {
      const rows = (rules as Record<string, unknown>[]).map((r) => ({
        ...r,
        tenant_id: tenantId,
        model_version_id: newVersionId,
      }));
      await supabase.from('scoring_rules').insert(rows);
    }
  }

  await writeAudit({
    action: 'SCORING_MODEL_VERSION_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: newVersionId,
    metadata: { modelId: parsed.data.modelId, clonedFrom: sourceId ?? null },
  });

  revalidatePath('/settings/scoring');
  revalidatePath(`/settings/scoring/${newVersionId}`);
  return { ok: true, id: newVersionId };
}

// --- Lifecycle transitions -------------------------------------------------

async function loadVersionStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  versionId: string,
): Promise<{ status: string; model_id: string } | null> {
  const { data } = await supabase
    .from('scoring_model_versions')
    .select('status, model_id')
    .eq('id', versionId)
    .maybeSingle();
  return data ? { status: data.status as string, model_id: data.model_id as string } : null;
}

export async function submitVersionForApproval(versionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status !== 'draft') return { error: 'Only a draft can be submitted.' };

  const { error } = await supabase
    .from('scoring_model_versions')
    .update({ status: 'pending_approval' })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'SCORING_MODEL_SUBMITTED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/scoring');
  return { ok: true };
}

export async function approveVersion(versionId: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.models.approve')) {
    return { error: 'You do not have permission to approve scoring models.' };
  }
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status !== 'pending_approval') {
    return { error: 'Only a pending version can be approved.' };
  }
  const { error } = await supabase
    .from('scoring_model_versions')
    .update({ approved_by: ctx.userId })
    .eq('id', versionId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'SCORING_MODEL_APPROVED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/scoring');
  return { ok: true };
}

export async function activateVersion(versionId: string): Promise<ActionResult> {
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
    .from('scoring_model_versions')
    .update({ status: 'retired' })
    .eq('tenant_id', tenantId)
    .eq('model_id', v.model_id)
    .eq('status', 'active');

  const { error } = await supabase
    .from('scoring_model_versions')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'SCORING_MODEL_ACTIVATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: versionId,
    metadata: { modelId: v.model_id },
  });
  revalidatePath('/settings/scoring');
  return { ok: true };
}

export async function retireVersion(versionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(versionId).success) return { error: 'Invalid version.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const v = await loadVersionStatus(supabase, versionId);
  if (!v || v.status === 'retired') return { error: 'Version not found or already retired.' };

  const { error } = await supabase
    .from('scoring_model_versions')
    .update({ status: 'retired' })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'SCORING_MODEL_RETIRED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: versionId,
  });
  revalidatePath('/settings/scoring');
  return { ok: true };
}

// --- Draft rule editing (JSON-or-form) -------------------------------------

const ruleSchema = z.object({
  group: z.enum(GROUPS as [RuleGroup, ...RuleGroup[]]),
  signalKey: z.string().min(1).max(120),
  operator: z.enum(OPERATORS as [RuleOperator, ...RuleOperator[]]),
  expected: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().default(0),
  maxContribution: z.number().default(0),
  minContribution: z.number().default(0),
  requiredEvidence: z.boolean().default(false),
  priority: z.number().int().default(100),
  stopProcessing: z.boolean().default(false),
  explanationTemplate: z.string().default(''),
  unknownHandling: z
    .enum(['zero', 'review', 'skip'] as [UnknownHandling, ...UnknownHandling[]])
    .default('zero'),
  reason: z.string().optional(),
});

const replaceRulesSchema = z.object({
  versionId: z.string().uuid(),
  thresholds: z
    .object({
      hot: z.number(),
      warm: z.number(),
      cold: z.number(),
      review: z.number(),
    })
    .optional(),
  scaleMin: z.number().int().optional(),
  scaleMax: z.number().int().optional(),
  rules: z.array(ruleSchema).max(200),
});

/**
 * Replace ALL rules on a DRAFT version (and optionally its thresholds/scale). The
 * active-version trigger forbids editing active rules; we also refuse here.
 * Thresholds are validated; prohibited signals are rejected before any write.
 */
export async function replaceDraftRules(
  input: z.infer<typeof replaceRulesSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = replaceRulesSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid rule payload.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data: version } = await supabase
    .from('scoring_model_versions')
    .select('status, scale_min, scale_max')
    .eq('id', parsed.data.versionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!version) return { error: 'Version not found.' };
  if (version.status !== 'draft') {
    return { error: 'Only a draft version can be edited. Create a new draft to change rules.' };
  }

  // Reject prohibited signals before writing anything.
  for (const r of parsed.data.rules) {
    if (isProhibitedSignal(r.signalKey)) {
      return { error: `Prohibited signal "${r.signalKey}" cannot be a scoring input.` };
    }
  }
  // Defensive domain guard (throws if any prohibited slip through).
  const domainRules: ScoringRule[] = parsed.data.rules.map((r, i) => ({
    id: `tmp-${i}`,
    group: r.group,
    signalKey: r.signalKey,
    operator: r.operator,
    expected: r.expected as ScoringRule['expected'],
    weight: r.weight,
    maxContribution: r.maxContribution,
    minContribution: r.minContribution,
    requiredEvidence: r.requiredEvidence,
    priority: r.priority,
    stopProcessing: r.stopProcessing,
    explanationTemplate: r.explanationTemplate,
    unknownHandling: r.unknownHandling,
    reason: r.reason,
  }));
  try {
    assertNoProhibitedSignals(domainRules);
  } catch {
    return { error: 'Prohibited signal in rules.' };
  }

  const scaleMin = parsed.data.scaleMin ?? (version.scale_min as number);
  const scaleMax = parsed.data.scaleMax ?? (version.scale_max as number);
  if (parsed.data.thresholds) {
    const tv = validateThresholds(parsed.data.thresholds as ScoringThresholds, {
      min: scaleMin,
      max: scaleMax,
    });
    if (!tv.ok) return { error: `Invalid thresholds: ${tv.error}` };
  }

  // Update version-level config first.
  await supabase
    .from('scoring_model_versions')
    .update({
      ...(parsed.data.thresholds ? { thresholds: parsed.data.thresholds } : {}),
      ...(parsed.data.scaleMin !== undefined ? { scale_min: parsed.data.scaleMin } : {}),
      ...(parsed.data.scaleMax !== undefined ? { scale_max: parsed.data.scaleMax } : {}),
    })
    .eq('id', parsed.data.versionId)
    .eq('tenant_id', tenantId);

  // Replace rules (draft only — trigger allows this).
  await supabase.from('scoring_rules').delete().eq('model_version_id', parsed.data.versionId);
  if (parsed.data.rules.length > 0) {
    const rows = parsed.data.rules.map((r) => ({
      tenant_id: tenantId,
      model_version_id: parsed.data.versionId,
      group_key: r.group,
      signal_key: r.signalKey,
      operator: r.operator,
      expected: r.expected ?? {},
      weight: r.weight,
      max_contribution: r.maxContribution,
      min_contribution: r.minContribution,
      required_evidence: r.requiredEvidence,
      priority: r.priority,
      stop_processing: r.stopProcessing,
      explanation_template: r.explanationTemplate,
      unknown_handling: r.unknownHandling,
      reason: r.reason ?? null,
    }));
    const { error } = await supabase.from('scoring_rules').insert(rows);
    if (error) return { error: error.message };
  }

  await writeAudit({
    action: 'SCORING_MODEL_VERSION_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_model_version',
    entityId: parsed.data.versionId,
    metadata: { rulesUpdated: parsed.data.rules.length },
  });

  revalidatePath(`/settings/scoring/${parsed.data.versionId}`);
  revalidatePath('/settings/scoring');
  return { ok: true };
}

// --- Signal definitions ----------------------------------------------------

const signalSchema = z.object({
  signalKey: z.string().min(1).max(120),
  category: z.enum([
    'intent',
    'fit',
    'engagement',
    'source',
    'freshness',
    'negative',
    'qualification',
  ]),
  valueType: z.enum(['boolean', 'number', 'string', 'string[]']).default('boolean'),
  description: z.string().max(500).optional(),
});

export async function createSignalDefinition(
  input: z.infer<typeof signalSchema>,
): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'scoring.signals.manage')) {
    return { error: 'You do not have permission to manage signals.' };
  }
  const parsed = signalSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid signal.' };
  if (isProhibitedSignal(parsed.data.signalKey)) {
    return { error: 'A prohibited signal can never be defined.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('scoring_signal_definitions')
    .insert({
      tenant_id: ctx.activeTenantId,
      signal_key: parsed.data.signalKey,
      category: parsed.data.category,
      value_type: parsed.data.valueType,
      description: parsed.data.description ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create signal.' };

  await writeAudit({
    action: 'SCORING_SIGNAL_CREATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'scoring_signal_definition',
    entityId: data.id as string,
    metadata: { signalKey: parsed.data.signalKey },
  });
  revalidatePath('/settings/scoring/signals');
  return { ok: true, id: data.id as string };
}
