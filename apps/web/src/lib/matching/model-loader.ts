import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MatchModelVersion,
  MatchRule,
  MatchRuleGroup,
  MatchRuleKind,
  MatchRuleOperator,
  MatchThresholds,
  MissingHandling,
} from '@re/domain';

/**
 * Phase 6B — load a tenant's persisted matching model version + its rules and map
 * them into the pure-domain `MatchModelVersion` shape that `calculateProjectMatches`
 * consumes. Only the rules of the chosen version are read; nothing here writes
 * anything. The model version row id is returned so a match run can record the
 * EXACT version used. Matching is ADVISORY only.
 */

export interface LoadedMatchModelVersion {
  modelVersionId: string;
  versionLabel: string;
  status: string;
  freshnessWindowDays: number;
  domain: MatchModelVersion;
}

interface VersionRow {
  id: string;
  model_id: string;
  version: string;
  status: string;
  scale_min: number;
  scale_max: number;
  thresholds: MatchThresholds | null;
  group_caps: Record<string, number> | null;
  group_minimums: Record<string, number> | null;
  freshness_window_days: number;
  preference_signals: string[] | null;
}

interface RuleRow {
  id: string;
  group_key: string;
  kind: string;
  operator: string;
  signal_key: string;
  candidate_field: string;
  expected: MatchRule['expected'] | null;
  weight: number | string;
  max_contribution: number | string;
  missing_handling: string;
  priority: number;
  explanation_template: string;
  reason: string | null;
  effective_at: string | null;
  expires_at: string | null;
}

const VERSION_COLS =
  'id, model_id, version, status, scale_min, scale_max, thresholds, group_caps, group_minimums, freshness_window_days, preference_signals';
const RULE_COLS =
  'id, group_key, kind, operator, signal_key, candidate_field, expected, weight, max_contribution, missing_handling, priority, explanation_template, reason, effective_at, expires_at';

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

function mapRule(r: RuleRow): MatchRule {
  return {
    id: r.id,
    group: r.group_key as MatchRuleGroup,
    kind: r.kind as MatchRuleKind,
    operator: r.operator as MatchRuleOperator,
    signalKey: r.signal_key,
    candidateField: r.candidate_field,
    expected: r.expected ?? undefined,
    weight: num(r.weight),
    maxContribution: num(r.max_contribution),
    missingHandling: (r.missing_handling as MissingHandling) ?? 'zero',
    priority: r.priority,
    explanationTemplate: r.explanation_template ?? '',
    reason: r.reason ?? undefined,
    effectiveAt: r.effective_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
  };
}

async function buildLoaded(
  supabase: SupabaseClient,
  tenantId: string,
  versionRow: VersionRow,
): Promise<LoadedMatchModelVersion> {
  const { data: ruleRows } = await supabase
    .from('matching_rules')
    .select(RULE_COLS)
    .eq('tenant_id', tenantId)
    .eq('model_version_id', versionRow.id)
    .order('priority', { ascending: true });

  const thresholds: MatchThresholds = versionRow.thresholds ?? {
    excellent: 70,
    good: 50,
    possible: 30,
    weak: 0,
  };

  return {
    modelVersionId: versionRow.id,
    versionLabel: versionRow.version,
    status: versionRow.status,
    freshnessWindowDays: versionRow.freshness_window_days,
    domain: {
      modelId: versionRow.model_id,
      version: versionRow.version,
      scale: { min: versionRow.scale_min, max: versionRow.scale_max },
      thresholds,
      rules: ((ruleRows ?? []) as RuleRow[]).map(mapRule),
      groupCaps: (versionRow.group_caps as MatchModelVersion['groupCaps']) ?? undefined,
      groupMinimums: (versionRow.group_minimums as MatchModelVersion['groupMinimums']) ?? undefined,
      freshnessWindowDays: versionRow.freshness_window_days,
      preferenceSignals: versionRow.preference_signals ?? undefined,
    },
  };
}

/** Load the tenant's single ACTIVE matching model version (default model) + rules. */
export async function loadActiveMatchModelVersion(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LoadedMatchModelVersion | null> {
  const { data: version } = await supabase
    .from('matching_model_versions')
    .select(VERSION_COLS)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return null;
  return buildLoaded(supabase, tenantId, version as VersionRow);
}

/** Load a specific matching model version by id (any status) + its rules. */
export async function loadMatchModelVersionById(
  supabase: SupabaseClient,
  tenantId: string,
  modelVersionId: string,
): Promise<LoadedMatchModelVersion | null> {
  const { data: version } = await supabase
    .from('matching_model_versions')
    .select(VERSION_COLS)
    .eq('tenant_id', tenantId)
    .eq('id', modelVersionId)
    .maybeSingle();
  if (!version) return null;
  return buildLoaded(supabase, tenantId, version as VersionRow);
}
