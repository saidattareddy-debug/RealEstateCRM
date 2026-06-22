/**
 * Phase 6A — deterministic lead scoring (pure domain).
 *
 * `calculateLeadScore` is the single source of truth for a lead's score. It is
 * deterministic, versioned, explainable and reproducible: identical
 * observations + rule version + calculation time + configuration always yield
 * an identical result. It performs NO IO — no DB, no AI provider, no messaging,
 * no lead-state mutation. The score is ADVISORY: nothing here changes a stage,
 * assignment, status, or triggers any communication.
 *
 * Safety invariants (proven by tests):
 *  - Protected/sensitive attributes can never be scoring inputs
 *    (`PROHIBITED_SIGNAL_KEYS` + `assertNoProhibitedSignals`); prohibited
 *    observations are ignored even if injected.
 *  - Missing data contributes zero, reduces evidence completeness, and never
 *    disqualifies on its own.
 *  - A high numeric score does not imply complete qualification — evidence
 *    completeness is tracked separately from the score.
 */

// ---------------------------------------------------------------------------
// Prohibited signals (fairness) — these can NEVER influence a score.
// ---------------------------------------------------------------------------

export const PROHIBITED_SIGNAL_KEYS = [
  'race',
  'ethnicity',
  'religion',
  'caste',
  'political_affiliation',
  'sexual_orientation',
  'disability',
  'medical_status',
  'gender',
  'family_status',
  'socioeconomic_profile',
  'accent',
  'name_demographic',
  'neighbourhood_demographic',
] as const;
export type ProhibitedSignalKey = (typeof PROHIBITED_SIGNAL_KEYS)[number];

const PROHIBITED_SET: ReadonlySet<string> = new Set(PROHIBITED_SIGNAL_KEYS);

export function isProhibitedSignal(signalKey: string): boolean {
  return PROHIBITED_SET.has(signalKey);
}

// ---------------------------------------------------------------------------
// Signals & observations
// ---------------------------------------------------------------------------

export type SignalState =
  | 'known'
  | 'unknown'
  | 'not_applicable'
  | 'contradictory'
  | 'stale'
  | 'unverified';

export type SignalValue = boolean | number | string | string[] | null;

export type ConfidenceCategory = 'high' | 'medium' | 'low';

export interface SignalObservation {
  signalKey: string;
  value: SignalValue;
  state: SignalState;
  /** ISO time the observation was made; used by date_recency operators. */
  observedAt?: string;
  confidence?: ConfidenceCategory;
}

// ---------------------------------------------------------------------------
// Rules & model version
// ---------------------------------------------------------------------------

export type RuleGroup =
  | 'intent'
  | 'fit'
  | 'engagement'
  | 'source'
  | 'freshness'
  | 'qualification'
  | 'negative'
  | 'disqualification';

export type RuleOperator =
  | 'boolean_true'
  | 'numeric_range'
  | 'enum_in'
  | 'date_recency'
  | 'count_gte'
  | 'completion'
  | 'exact_match'
  | 'set_intersection'
  | 'missing_value'
  | 'disqualify'
  | 'review_required';

/** How a rule treats an unknown/missing observation. */
export type UnknownHandling = 'zero' | 'review' | 'skip';

export interface ScoringRule {
  id: string;
  group: RuleGroup;
  signalKey: string;
  operator: RuleOperator;
  /** Operator parameters (range bounds, enum set, recency days, count, match). */
  expected?: {
    min?: number;
    max?: number;
    set?: string[];
    days?: number;
    count?: number;
    value?: SignalValue;
  };
  weight: number;
  maxContribution: number;
  minContribution: number;
  requiredEvidence: boolean;
  effectiveAt?: string;
  expiresAt?: string;
  priority: number;
  stopProcessing: boolean;
  explanationTemplate: string;
  unknownHandling: UnknownHandling;
  /** For disqualify/review rules, the reason recorded when matched. */
  reason?: string;
}

export interface ScoringThresholds {
  hot: number;
  warm: number;
  cold: number;
  /** Below this, the lead is flagged for review rather than auto-classified. */
  review: number;
}

export interface ScoringModelVersion {
  modelId: string;
  version: string;
  scale: { min: number; max: number };
  thresholds: ScoringThresholds;
  rules: ScoringRule[];
  groupCaps?: Partial<Record<RuleGroup, number>>;
  groupMinimums?: Partial<Record<RuleGroup, number>>;
  totalBounds?: { min: number; max: number };
  /** Signals that must be known for the lead to count as fully qualified. */
  qualificationSignals?: string[];
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ScoreClassification =
  | 'hot'
  | 'warm'
  | 'cold'
  | 'disqualified'
  | 'unscored'
  | 'review_required';

export interface ScoreComponent {
  ruleId: string;
  group: RuleGroup;
  signalKey: string;
  contribution: number;
  applied: boolean;
  skippedReason?: string;
  explanation: string;
}

export interface LeadScoreResult {
  score: number;
  classification: ScoreClassification;
  /** 0..1 — fraction of required-evidence/qualification signals that are known. */
  evidenceCompleteness: number;
  /** 0..1 — confidence in the calculation given evidence + staleness. */
  calculationConfidence: number;
  components: ScoreComponent[];
  appliedRules: string[];
  skippedRules: string[];
  missingSignals: string[];
  contradictions: string[];
  disqualification: { disqualified: boolean; reason?: string };
  reviewRequired: { required: boolean; reason?: string };
  qualificationComplete: boolean;
  explanation: string[];
  modelVersion: string;
  calculatedAt: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Throws if any rule targets a prohibited signal. Used at model-config time. */
export function assertNoProhibitedSignals(rules: ScoringRule[]): void {
  const offenders = rules.filter((r) => isProhibitedSignal(r.signalKey)).map((r) => r.signalKey);
  if (offenders.length > 0) {
    throw new Error(`prohibited_signal_in_rules:${[...new Set(offenders)].join(',')}`);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ruleActive(rule: ScoringRule, now: number): boolean {
  if (rule.effectiveAt && now < new Date(rule.effectiveAt).getTime()) return false;
  if (rule.expiresAt && now >= new Date(rule.expiresAt).getTime()) return false;
  return true;
}

/** Evaluate whether a known observation matches the rule's operator. */
function operatorMatches(rule: ScoringRule, obs: SignalObservation, now: number): boolean {
  const v = obs.value;
  const e = rule.expected ?? {};
  switch (rule.operator) {
    case 'boolean_true':
      return v === true;
    case 'numeric_range': {
      if (typeof v !== 'number') return false;
      const lo = e.min ?? -Infinity;
      const hi = e.max ?? Infinity;
      return v >= lo && v <= hi;
    }
    case 'enum_in':
      return typeof v === 'string' && (e.set ?? []).includes(v);
    case 'exact_match':
      return v === e.value;
    case 'count_gte':
      return typeof v === 'number' && v >= (e.count ?? 0);
    case 'completion':
      return v !== null && v !== undefined && v !== '' && obs.state === 'known';
    case 'set_intersection':
      return Array.isArray(v) && (e.set ?? []).some((s) => v.includes(s));
    case 'date_recency': {
      if (!obs.observedAt) return false;
      const ageDays = (now - new Date(obs.observedAt).getTime()) / 86_400_000;
      return ageDays <= (e.days ?? Infinity);
    }
    case 'missing_value':
      return false; // handled by the unknown branch
    case 'disqualify':
    case 'review_required':
      return v === true || (typeof v === 'string' && v === (e.value ?? true));
  }
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

export interface CalculateLeadScoreInput {
  modelVersion: ScoringModelVersion;
  observations: SignalObservation[];
  calculatedAt: string;
}

export function calculateLeadScore(input: CalculateLeadScoreInput): LeadScoreResult {
  const { modelVersion, calculatedAt } = input;
  const now = new Date(calculatedAt).getTime();

  // Prohibited observations are dropped before anything else.
  const observations = input.observations.filter((o) => !isProhibitedSignal(o.signalKey));
  const byKey = new Map<string, SignalObservation>();
  for (const o of observations) byKey.set(o.signalKey, o);

  // Deterministic ordering: priority asc, then id.
  const rules = [...modelVersion.rules].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const components: ScoreComponent[] = [];
  const appliedRules: string[] = [];
  const skippedRules: string[] = [];
  const missingSignals: string[] = [];
  const contradictions: string[] = [];
  const explanation: string[] = [];
  const groupTotals = new Map<RuleGroup, number>();

  let disqualified = false;
  let disqualificationReason: string | undefined;
  let reviewRequired = false;
  let reviewReason: string | undefined;
  let stopped = false;

  let requiredKnown = 0;
  let requiredTotal = 0;
  let staleCount = 0;

  for (const rule of rules) {
    if (stopped) {
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'stopped_by_prior_rule'));
      continue;
    }
    if (!ruleActive(rule, now)) {
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'rule_not_in_effect'));
      continue;
    }

    const obs = byKey.get(rule.signalKey);
    if (rule.requiredEvidence) requiredTotal += 1;

    // ----- Missing / unknown / special states -----
    const known = obs && obs.state === 'known';
    if (!obs || obs.state === 'unknown') {
      missingSignals.push(rule.signalKey);
      if (rule.operator === 'missing_value') {
        // A missing_value rule fires precisely when the signal is absent.
        const contribution = clamp(rule.weight, rule.minContribution, rule.maxContribution);
        addContribution(rule, contribution);
        continue;
      }
      if (rule.unknownHandling === 'review') {
        reviewRequired = true;
        reviewReason ??= `missing:${rule.signalKey}`;
      }
      // 'zero' and 'review' contribute zero; 'skip' is also zero but marked.
      skippedRules.push(rule.id);
      components.push(
        mk(rule, 0, false, rule.unknownHandling === 'skip' ? 'unknown_skip' : 'unknown_zero'),
      );
      continue;
    }
    if (obs.state === 'not_applicable') {
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'not_applicable'));
      continue;
    }
    if (obs.state === 'contradictory') {
      contradictions.push(rule.signalKey);
      reviewRequired = true;
      reviewReason ??= `contradictory:${rule.signalKey}`;
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'contradictory_requires_review'));
      continue;
    }
    if (obs.state === 'stale') {
      staleCount += 1;
      // Stale evidence does not contribute but is flagged; recency rules fail.
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'stale_evidence'));
      continue;
    }
    if (obs.state === 'unverified') {
      // Unverified evidence is treated cautiously: contributes zero, no DQ.
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'unverified_evidence'));
      continue;
    }

    if (known && rule.requiredEvidence) requiredKnown += 1;

    const matched = operatorMatches(rule, obs, now);

    if (rule.operator === 'disqualify') {
      if (matched) {
        disqualified = true;
        disqualificationReason = rule.reason ?? `disqualified:${rule.signalKey}`;
        appliedRules.push(rule.id);
        components.push(mk(rule, 0, true, undefined));
        explanation.push(rule.explanationTemplate);
        if (rule.stopProcessing) stopped = true;
      } else {
        skippedRules.push(rule.id);
        components.push(mk(rule, 0, false, 'disqualify_not_matched'));
      }
      continue;
    }
    if (rule.operator === 'review_required') {
      if (matched) {
        reviewRequired = true;
        reviewReason ??= rule.reason ?? `review:${rule.signalKey}`;
        appliedRules.push(rule.id);
        components.push(mk(rule, 0, true, undefined));
        explanation.push(rule.explanationTemplate);
        if (rule.stopProcessing) stopped = true;
      } else {
        skippedRules.push(rule.id);
        components.push(mk(rule, 0, false, 'review_not_matched'));
      }
      continue;
    }

    const contribution = matched
      ? clamp(rule.weight, rule.minContribution, rule.maxContribution)
      : 0;
    if (matched) {
      addContribution(rule, contribution);
    } else {
      skippedRules.push(rule.id);
      components.push(mk(rule, 0, false, 'operator_not_matched'));
    }
  }

  // ----- Group caps / minimums + total -----
  let total = 0;
  for (const [group, raw] of groupTotals) {
    let g = raw;
    const cap = modelVersion.groupCaps?.[group];
    if (cap !== undefined) g = Math.min(g, cap);
    const min = modelVersion.groupMinimums?.[group];
    if (min !== undefined) g = Math.max(g, min);
    total += g;
  }
  const tb = modelVersion.totalBounds;
  if (tb) total = clamp(total, tb.min, tb.max);
  const score = clamp(Math.round(total), modelVersion.scale.min, modelVersion.scale.max);

  // ----- Evidence completeness & confidence (separate from score) -----
  const evidenceCompleteness = requiredTotal === 0 ? 1 : requiredKnown / requiredTotal;
  const consideredRules = rules.length || 1;
  const stalePenalty = staleCount / consideredRules;
  const calculationConfidence = clamp(evidenceCompleteness * (1 - stalePenalty), 0, 1);

  // Qualification completeness — explicitly separate from the numeric score.
  const qualSignals = modelVersion.qualificationSignals ?? [];
  const qualificationComplete =
    qualSignals.length === 0
      ? evidenceCompleteness >= 1
      : qualSignals.every((k) => byKey.get(k)?.state === 'known');

  // ----- Classification -----
  let classification: ScoreClassification;
  if (disqualified) {
    classification = 'disqualified';
  } else if (reviewRequired) {
    classification = 'review_required';
  } else if (appliedRules.length === 0 && missingSignals.length > 0) {
    classification = 'unscored';
  } else {
    const t = modelVersion.thresholds;
    classification = score >= t.hot ? 'hot' : score >= t.warm ? 'warm' : 'cold';
  }

  // ----- Explanation lines -----
  for (const c of components) {
    if (c.applied && c.contribution > 0) explanation.push(`+${c.contribution} ${c.explanation}`);
  }
  if (missingSignals.length > 0)
    explanation.push(`Missing: ${[...new Set(missingSignals)].join(', ')}`);
  if (contradictions.length > 0)
    explanation.push(`Contradictions need review: ${[...new Set(contradictions)].join(', ')}`);
  if (disqualified && disqualificationReason)
    explanation.push(`Disqualified: ${disqualificationReason}`);

  return {
    score,
    classification,
    evidenceCompleteness,
    calculationConfidence,
    components,
    appliedRules,
    skippedRules,
    missingSignals: [...new Set(missingSignals)],
    contradictions: [...new Set(contradictions)],
    disqualification: { disqualified, reason: disqualificationReason },
    reviewRequired: { required: reviewRequired, reason: reviewReason },
    qualificationComplete,
    explanation,
    modelVersion: modelVersion.version,
    calculatedAt,
  };

  function addContribution(rule: ScoringRule, contribution: number) {
    appliedRules.push(rule.id);
    groupTotals.set(rule.group, (groupTotals.get(rule.group) ?? 0) + contribution);
    components.push(mk(rule, contribution, true, undefined));
    if (rule.stopProcessing) stopped = true;
  }

  function mk(
    rule: ScoringRule,
    contribution: number,
    applied: boolean,
    skippedReason: string | undefined,
  ): ScoreComponent {
    return {
      ruleId: rule.id,
      group: rule.group,
      signalKey: rule.signalKey,
      contribution,
      applied,
      skippedReason,
      explanation: rule.explanationTemplate,
    };
  }
}

// ---------------------------------------------------------------------------
// Manual overrides (advisory; never erase the calculated result)
// ---------------------------------------------------------------------------

export interface ScoreOverride {
  score?: number;
  classification?: ScoreClassification;
  disqualifyRecommendationCleared?: boolean;
  reviewCleared?: boolean;
  reason: string;
  actorId: string;
  appliedAt: string;
  expiresAt?: string;
}

export interface EffectiveScore {
  calculatedScore: number;
  calculatedClassification: ScoreClassification;
  effectiveScore: number;
  effectiveClassification: ScoreClassification;
  overrideActive: boolean;
  overrideReason?: string;
  overrideExpiresAt?: string;
}

/**
 * Combine a calculated result with an optional manual override. An expired
 * override is ignored. The calculated values are always preserved alongside the
 * effective ones.
 */
export function effectiveScore(
  result: LeadScoreResult,
  override: ScoreOverride | null,
  now: string,
): EffectiveScore {
  const base: EffectiveScore = {
    calculatedScore: result.score,
    calculatedClassification: result.classification,
    effectiveScore: result.score,
    effectiveClassification: result.classification,
    overrideActive: false,
  };
  if (!override) return base;
  const expired = override.expiresAt
    ? new Date(now).getTime() >= new Date(override.expiresAt).getTime()
    : false;
  if (expired) return base;

  return {
    ...base,
    effectiveScore: override.score ?? result.score,
    effectiveClassification: override.classification ?? result.classification,
    overrideActive: true,
    overrideReason: override.reason,
    overrideExpiresAt: override.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Threshold validation (model-config time)
// ---------------------------------------------------------------------------

export function validateThresholds(
  t: ScoringThresholds,
  scale: { min: number; max: number },
): {
  ok: boolean;
  error?: string;
} {
  const inBounds = [t.hot, t.warm, t.cold, t.review].every((n) => n >= scale.min && n <= scale.max);
  if (!inBounds) return { ok: false, error: 'threshold_out_of_bounds' };
  if (!(t.hot > t.warm && t.warm > t.cold)) return { ok: false, error: 'threshold_order_invalid' };
  return { ok: true };
}
