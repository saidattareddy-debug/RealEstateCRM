import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RuleGroup,
  RuleOperator,
  ScoringModelVersion,
  ScoringRule,
  ScoringThresholds,
  UnknownHandling,
} from '@re/domain';

/**
 * Phase 6A — load a tenant's persisted scoring model version + its rules and map
 * them into the pure-domain `ScoringModelVersion` shape that `calculateLeadScore`
 * consumes. Only ACTIVE rules of the chosen version are read; nothing here writes
 * anything. The model version row id is returned so a score run can record the
 * EXACT version used.
 */

export interface LoadedModelVersion {
  modelVersionId: string;
  versionLabel: string;
  status: string;
  domain: ScoringModelVersion;
}

interface VersionRow {
  id: string;
  model_id: string;
  version: string;
  status: string;
  scale_min: number;
  scale_max: number;
  thresholds: ScoringThresholds | null;
  group_caps: Record<string, number> | null;
  group_minimums: Record<string, number> | null;
  total_min: number | null;
  total_max: number | null;
  qualification_signals: string[] | null;
}

interface RuleRow {
  id: string;
  group_key: string;
  signal_key: string;
  operator: string;
  expected: ScoringRule['expected'] | null;
  weight: number | string;
  max_contribution: number | string;
  min_contribution: number | string;
  required_evidence: boolean;
  effective_at: string | null;
  expires_at: string | null;
  priority: number;
  stop_processing: boolean;
  explanation_template: string;
  unknown_handling: string;
  reason: string | null;
}

const VERSION_COLS =
  'id, model_id, version, status, scale_min, scale_max, thresholds, group_caps, group_minimums, total_min, total_max, qualification_signals';
const RULE_COLS =
  'id, group_key, signal_key, operator, expected, weight, max_contribution, min_contribution, required_evidence, effective_at, expires_at, priority, stop_processing, explanation_template, unknown_handling, reason';

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

function mapRule(r: RuleRow): ScoringRule {
  return {
    id: r.id,
    group: r.group_key as RuleGroup,
    signalKey: r.signal_key,
    operator: r.operator as RuleOperator,
    expected: r.expected ?? undefined,
    weight: num(r.weight),
    maxContribution: num(r.max_contribution),
    minContribution: num(r.min_contribution),
    requiredEvidence: Boolean(r.required_evidence),
    effectiveAt: r.effective_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
    priority: r.priority,
    stopProcessing: Boolean(r.stop_processing),
    explanationTemplate: r.explanation_template ?? '',
    unknownHandling: (r.unknown_handling as UnknownHandling) ?? 'zero',
    reason: r.reason ?? undefined,
  };
}

async function buildLoaded(
  supabase: SupabaseClient,
  tenantId: string,
  versionRow: VersionRow,
): Promise<LoadedModelVersion> {
  const { data: ruleRows } = await supabase
    .from('scoring_rules')
    .select(RULE_COLS)
    .eq('tenant_id', tenantId)
    .eq('model_version_id', versionRow.id)
    .order('priority', { ascending: true });

  const thresholds: ScoringThresholds = versionRow.thresholds ?? {
    hot: 70,
    warm: 40,
    cold: 0,
    review: 0,
  };
  const totalBounds =
    versionRow.total_min !== null && versionRow.total_max !== null
      ? { min: versionRow.total_min, max: versionRow.total_max }
      : undefined;

  return {
    modelVersionId: versionRow.id,
    versionLabel: versionRow.version,
    status: versionRow.status,
    domain: {
      modelId: versionRow.model_id,
      version: versionRow.version,
      scale: { min: versionRow.scale_min, max: versionRow.scale_max },
      thresholds,
      rules: ((ruleRows ?? []) as RuleRow[]).map(mapRule),
      groupCaps: (versionRow.group_caps as ScoringModelVersion['groupCaps']) ?? undefined,
      groupMinimums:
        (versionRow.group_minimums as ScoringModelVersion['groupMinimums']) ?? undefined,
      totalBounds,
      qualificationSignals: versionRow.qualification_signals ?? undefined,
    },
  };
}

/** Load the tenant's single ACTIVE model version (default model) + its rules. */
export async function loadActiveModelVersion(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LoadedModelVersion | null> {
  const { data: version } = await supabase
    .from('scoring_model_versions')
    .select(VERSION_COLS)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return null;
  return buildLoaded(supabase, tenantId, version as VersionRow);
}

/** Load a specific model version by id (any status) + its rules. */
export async function loadModelVersionById(
  supabase: SupabaseClient,
  tenantId: string,
  modelVersionId: string,
): Promise<LoadedModelVersion | null> {
  const { data: version } = await supabase
    .from('scoring_model_versions')
    .select(VERSION_COLS)
    .eq('tenant_id', tenantId)
    .eq('id', modelVersionId)
    .maybeSingle();
  if (!version) return null;
  return buildLoaded(supabase, tenantId, version as VersionRow);
}
