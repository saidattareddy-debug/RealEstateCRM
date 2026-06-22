/**
 * Phase 6B — deterministic project/configuration/unit matching (pure domain).
 *
 * `calculateProjectMatches` ranks candidate projects/configurations/units for a
 * lead. It is deterministic, versioned, explainable and reproducible, and does
 * NO IO. Matching is ADVISORY: it never assigns a lead, changes a stage/status/
 * score, reserves inventory, or sends anything.
 *
 * Inventory safety: a specific unit is only ever surfaced as CONFIRMED available
 * when its real record is in-tenant, in an active+approved project, status
 * `available`, and within the freshness window. Otherwise the unit is flagged
 * (stale / unknown / requires re-verification) and never presented as confirmed.
 *
 * Fairness: protected/sensitive attributes (`PROHIBITED_SIGNAL_KEYS` from
 * `scoring.ts`) can never be matching inputs; prohibited rule inputs are rejected
 * and prohibited lead fields are dropped.
 */

import { isProhibitedSignal } from './scoring';
import { fnv1aHex } from './chunking';

export type MatchLevel = 'project' | 'configuration' | 'unit';

export type MatchRuleKind = 'hard' | 'soft' | 'informational' | 'review_required';

export type MatchRuleGroup =
  | 'budget'
  | 'configuration'
  | 'location'
  | 'property_type'
  | 'area'
  | 'possession'
  | 'amenities'
  | 'lifestyle'
  | 'financing'
  | 'inventory'
  | 'freshness'
  | 'exclusions';

export type MatchRuleOperator =
  | 'boolean_true'
  | 'enum_in'
  | 'numeric_range'
  | 'budget_overlap'
  | 'area_overlap'
  | 'date_window_overlap'
  | 'distance_threshold'
  | 'set_intersection'
  | 'required_feature'
  | 'preferred_feature'
  | 'missing_value'
  | 'exclusion'
  | 'review_required'
  | 'freshness';

export type MissingHandling = 'zero' | 'fail' | 'review' | 'skip';

export type InventoryState =
  | 'verified_available'
  | 'available_stale'
  | 'no_matching_available'
  | 'availability_unknown'
  | 'not_available'
  | 'requires_reverification';

export type BudgetOutcome =
  | 'within'
  | 'near'
  | 'above_preferred'
  | 'above_absolute'
  | 'budget_unknown'
  | 'price_unknown'
  | 'requires_verification';

export type MatchClassification =
  | 'excellent'
  | 'good'
  | 'possible'
  | 'weak'
  | 'ineligible'
  | 'review_required'
  | 'insufficient_information';

export interface MatchThresholds {
  excellent: number;
  good: number;
  possible: number;
  weak: number;
}

export interface MatchRule {
  id: string;
  group: MatchRuleGroup;
  kind: MatchRuleKind;
  operator: MatchRuleOperator;
  /** The lead-preference key this rule reads. */
  signalKey: string;
  /** The candidate field this rule compares against. */
  candidateField: string;
  expected?: {
    set?: string[];
    min?: number;
    max?: number;
    days?: number;
    distance?: number;
    value?: unknown;
  };
  weight: number;
  maxContribution: number;
  missingHandling: MissingHandling;
  priority: number;
  explanationTemplate: string;
  reason?: string;
  effectiveAt?: string;
  expiresAt?: string;
}

export interface MatchModelVersion {
  modelId: string;
  version: string;
  scale: { min: number; max: number };
  thresholds: MatchThresholds;
  rules: MatchRule[];
  groupCaps?: Partial<Record<MatchRuleGroup, number>>;
  groupMinimums?: Partial<Record<MatchRuleGroup, number>>;
  freshnessWindowDays: number;
  /** Preference keys that should be known for a confident match. */
  preferenceSignals?: string[];
}

/** Range or scalar lead preference value. */
export type PreferenceValue =
  | boolean
  | number
  | string
  | string[]
  | { min?: number; max?: number }
  | null;

export interface LeadSnapshot {
  /** Structured lead preferences keyed by signal. Prohibited keys are dropped. */
  preferences: Record<string, PreferenceValue>;
  budgetMin?: number;
  budgetMax?: number;
  preferredBudget?: number;
  absoluteMaxBudget?: number;
}

export interface MatchCandidate {
  id: string;
  level: MatchLevel;
  tenantId: string;
  projectId: string;
  projectConfigurationId?: string;
  inventoryUnitId?: string;
  // Eligibility flags (resolved by the server from real records).
  inTenant: boolean;
  projectActive: boolean;
  projectApproved: boolean;
  projectVisible: boolean;
  saleApplicable: boolean;
  propertyCategoryAllowed: boolean;
  excludedByLead: boolean;
  // Candidate data fields read by rules (keyed by candidateField).
  fields: Record<string, unknown>;
  // Budget data.
  advertisedMin?: number;
  advertisedMax?: number;
  configBaseMin?: number;
  configBaseMax?: number;
  unitPrice?: number;
  // Inventory data (unit-level).
  unitStatus?: string;
  unitVerifiedAt?: string;
  reservationConflict?: boolean;
}

export interface MatchComponent {
  ruleId: string;
  group: MatchRuleGroup;
  kind: MatchRuleKind;
  signalKey: string;
  contribution: number;
  applied: boolean;
  positive: boolean;
  skippedReason?: string;
  explanation: string;
}

export interface MatchCandidateResult {
  candidateId: string;
  level: MatchLevel;
  projectId: string;
  projectConfigurationId?: string;
  inventoryUnitId?: string;
  eligible: boolean;
  score: number;
  classification: MatchClassification;
  /** 0..1 — confidence given known preferences + inventory certainty. */
  confidence: number;
  /** 0..1 — fraction of the model's preference signals that are known. */
  preferenceCompleteness: number;
  inventoryState: InventoryState;
  /** A unit may be presented as confirmed only when true. */
  unitConfirmedAvailable: boolean;
  budgetOutcome: BudgetOutcome;
  hardFailures: string[];
  positiveComponents: MatchComponent[];
  negativeComponents: MatchComponent[];
  missingPreferences: string[];
  contradictions: string[];
  reviewRequired: boolean;
  reviewReason?: string;
  explanation: string[];
  rank: number;
}

export interface MatchRunResult {
  rankedCandidates: MatchCandidateResult[];
  modelVersion: string;
  calculatedAt: string;
}

export interface CalculateProjectMatchesInput {
  modelVersion: MatchModelVersion;
  leadSnapshot: LeadSnapshot;
  candidates: MatchCandidate[];
  calculatedAt: string;
}

// ---------------------------------------------------------------------------
// AI preference extraction (review-only) — pure validation + idempotency.
// The matching engine consumes APPROVED preferences only; a pending/rejected
// extraction never reaches `calculateProjectMatches`.
// ---------------------------------------------------------------------------

/** The only lead-preference fields an AI extraction may propose. */
export const EXTRACTION_FIELDS = [
  'budget',
  'configuration',
  'bedrooms',
  'propertyType',
  'preferredProject',
  'locality',
  'excludedLocalities',
  'area',
  'possessionTimeframe',
  'amenities',
  'financingIntent',
  'siteVisitInterest',
  'exclusions',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

const EXTRACTION_FIELD_SET: ReadonlySet<string> = new Set(EXTRACTION_FIELDS);

export interface ExtractionProposalInput {
  signalKey: string;
  value: unknown;
  valueType?: string;
}

export interface ExtractionValidation {
  ok: boolean;
  reason?: 'prohibited' | 'unknown_field' | 'malformed';
}

/** Validate a single AI extraction proposal: not prohibited, an allowed field, well-formed. */
export function validateExtractionProposal(p: ExtractionProposalInput): ExtractionValidation {
  if (isProhibitedSignal(p.signalKey)) return { ok: false, reason: 'prohibited' };
  if (!EXTRACTION_FIELD_SET.has(p.signalKey)) return { ok: false, reason: 'unknown_field' };
  const v = p.value;
  if (v === undefined || v === null) return { ok: false, reason: 'malformed' };
  if (typeof v === 'string' && v.trim() === '') return { ok: false, reason: 'malformed' };
  if (Array.isArray(v) && v.length === 0) return { ok: false, reason: 'malformed' };
  return { ok: true };
}

export interface ExtractionKeyParts {
  tenantId: string;
  leadId: string;
  signalKey: string;
  promptVersion: string;
  modelConfig: string;
  value: string;
}

/** A deterministic idempotency key so a repeated extraction is a no-op. */
export function buildExtractionIdempotencyKey(p: ExtractionKeyParts): string {
  return fnv1aHex(
    [p.tenantId, p.leadId, p.signalKey, p.promptVersion, p.modelConfig, p.value].join('|'),
  );
}

/** Throws if any rule reads a prohibited signal/candidate field. */
export function assertNoProhibitedMatchInputs(rules: MatchRule[]): void {
  const bad = rules
    .filter((r) => isProhibitedSignal(r.signalKey) || isProhibitedSignal(r.candidateField))
    .map((r) => r.signalKey);
  if (bad.length > 0) throw new Error(`prohibited_match_input:${[...new Set(bad)].join(',')}`);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rangeOverlap(aMin?: number, aMax?: number, bMin?: number, bMax?: number): boolean {
  const lo1 = aMin ?? -Infinity;
  const hi1 = aMax ?? Infinity;
  const lo2 = bMin ?? -Infinity;
  const hi2 = bMax ?? Infinity;
  return lo1 <= hi2 && lo2 <= hi1;
}

function asRange(v: PreferenceValue): { min?: number; max?: number } | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as { min?: number; max?: number };
  if (typeof v === 'number') return { min: v, max: v };
  return null;
}

function ruleActive(rule: MatchRule, now: number): boolean {
  if (rule.effectiveAt && now < new Date(rule.effectiveAt).getTime()) return false;
  if (rule.expiresAt && now >= new Date(rule.expiresAt).getTime()) return false;
  return true;
}

function inventoryStateFor(
  candidate: MatchCandidate,
  model: MatchModelVersion,
  now: number,
): InventoryState {
  if (candidate.level !== 'unit') {
    // Project/config: availability is "unknown" unless data says otherwise.
    if (candidate.fields['hasFreshAvailableUnit'] === true) return 'verified_available';
    if (candidate.fields['hasAvailableUnit'] === true) return 'available_stale';
    if (candidate.fields['hasAvailableUnit'] === false) return 'no_matching_available';
    return 'availability_unknown';
  }
  if (candidate.unitStatus !== 'available') return 'not_available';
  if (candidate.reservationConflict) return 'requires_reverification';
  if (!candidate.unitVerifiedAt) return 'availability_unknown';
  const ageDays = (now - new Date(candidate.unitVerifiedAt).getTime()) / 86_400_000;
  if (ageDays > model.freshnessWindowDays) return 'available_stale';
  return 'verified_available';
}

function budgetOutcomeFor(lead: LeadSnapshot, candidate: MatchCandidate): BudgetOutcome {
  const price =
    candidate.unitPrice ?? candidate.configBaseMin ?? candidate.advertisedMin ?? undefined;
  const hasBudget =
    lead.preferredBudget !== undefined ||
    lead.budgetMax !== undefined ||
    lead.absoluteMaxBudget !== undefined;
  if (!hasBudget) return 'budget_unknown';
  if (price === undefined) return 'price_unknown';
  if (lead.absoluteMaxBudget !== undefined && price > lead.absoluteMaxBudget)
    return 'above_absolute';
  if (lead.preferredBudget !== undefined && price > lead.preferredBudget) {
    const near = price <= lead.preferredBudget * 1.1;
    return near ? 'near' : 'above_preferred';
  }
  if (lead.budgetMax !== undefined && price > lead.budgetMax) return 'above_preferred';
  return 'within';
}

export function calculateProjectMatches(input: CalculateProjectMatchesInput): MatchRunResult {
  const { modelVersion, calculatedAt } = input;
  const now = new Date(calculatedAt).getTime();

  // Drop prohibited lead preferences defensively.
  const preferences: Record<string, PreferenceValue> = {};
  for (const [k, v] of Object.entries(input.leadSnapshot.preferences)) {
    if (!isProhibitedSignal(k)) preferences[k] = v;
  }
  const lead: LeadSnapshot = { ...input.leadSnapshot, preferences };

  const rules = [...modelVersion.rules]
    .filter((r) => !isProhibitedSignal(r.signalKey) && !isProhibitedSignal(r.candidateField))
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1));

  const prefSignals = modelVersion.preferenceSignals ?? [];

  const results: MatchCandidateResult[] = input.candidates.map((candidate) => {
    const hardFailures: string[] = [];
    // Eligibility gates (candidate generation safety).
    if (!candidate.inTenant) hardFailures.push('cross_tenant');
    if (!candidate.projectActive) hardFailures.push('project_inactive');
    if (!candidate.projectApproved) hardFailures.push('project_unapproved');
    if (!candidate.projectVisible) hardFailures.push('not_visible');
    if (!candidate.saleApplicable) hardFailures.push('not_sale_applicable');
    if (!candidate.propertyCategoryAllowed) hardFailures.push('property_category');
    if (candidate.excludedByLead) hardFailures.push('excluded_by_lead');

    const positive: MatchComponent[] = [];
    const negative: MatchComponent[] = [];
    const missingPreferences: string[] = [];
    const contradictions: string[] = [];
    const explanation: string[] = [];
    const groupTotals = new Map<MatchRuleGroup, number>();
    let reviewRequired = false;
    let reviewReason: string | undefined;
    let knownPrefs = 0;

    for (const sig of prefSignals) {
      const v = preferences[sig];
      if (v !== undefined && v !== null) knownPrefs += 1;
    }

    // Only evaluate rules when the candidate is not already hard-ineligible by
    // generation gates — but still evaluate hard rules to collect reasons.
    for (const rule of rules) {
      if (!ruleActive(rule, now)) continue;
      const pref = preferences[rule.signalKey];
      const cand = candidate.fields[rule.candidateField];
      const known = pref !== undefined && pref !== null;

      if (!known) {
        missingPreferences.push(rule.signalKey);
        if (rule.missingHandling === 'fail' && rule.kind === 'hard') {
          hardFailures.push(`missing_required:${rule.signalKey}`);
        } else if (rule.missingHandling === 'review') {
          reviewRequired = true;
          reviewReason ??= `missing:${rule.signalKey}`;
        }
        continue; // zero / skip contribute nothing
      }

      const matched = evaluateMatchOperator(rule, pref, cand, lead, candidate, now);

      if (rule.operator === 'review_required') {
        if (matched) {
          reviewRequired = true;
          reviewReason ??= rule.reason ?? `review:${rule.signalKey}`;
        }
        continue;
      }
      if (rule.kind === 'hard' || rule.operator === 'exclusion') {
        if (!matched) {
          hardFailures.push(rule.reason ?? `hard_fail:${rule.signalKey}`);
          negative.push(mk(rule, 0, false, false, 'hard_constraint_failed'));
        } else {
          positive.push(mk(rule, 0, true, true, undefined));
        }
        continue;
      }
      if (rule.kind === 'informational') {
        positive.push(mk(rule, 0, matched, matched, matched ? undefined : 'informational'));
        continue;
      }
      // Soft preference contribution.
      const contribution = matched ? clamp(rule.weight, 0, rule.maxContribution) : 0;
      if (matched) {
        groupTotals.set(rule.group, (groupTotals.get(rule.group) ?? 0) + contribution);
        positive.push(mk(rule, contribution, true, true, undefined));
      } else {
        negative.push(mk(rule, 0, false, false, 'preference_not_met'));
      }
    }

    // Group caps / minimums + total.
    let total = 0;
    for (const [group, raw] of groupTotals) {
      let g = raw;
      const cap = modelVersion.groupCaps?.[group];
      if (cap !== undefined) g = Math.min(g, cap);
      const min = modelVersion.groupMinimums?.[group];
      if (min !== undefined) g = Math.max(g, min);
      total += g;
    }
    const score = clamp(Math.round(total), modelVersion.scale.min, modelVersion.scale.max);

    const inventoryState = inventoryStateFor(candidate, modelVersion, now);
    const budgetOutcome = budgetOutcomeFor(lead, candidate);
    const eligible = hardFailures.length === 0;
    const unitConfirmedAvailable =
      candidate.level === 'unit' && inventoryState === 'verified_available';

    const preferenceCompleteness = prefSignals.length === 0 ? 1 : knownPrefs / prefSignals.length;
    // Inventory certainty contributes to confidence.
    const invConfidence =
      inventoryState === 'verified_available'
        ? 1
        : inventoryState === 'available_stale'
          ? 0.6
          : inventoryState === 'availability_unknown'
            ? 0.4
            : 0.2;
    const confidence = clamp(preferenceCompleteness * invConfidence, 0, 1);

    // Classification.
    let classification: MatchClassification;
    if (!eligible) {
      classification = 'ineligible';
    } else if (reviewRequired) {
      classification = 'review_required';
    } else if (preferenceCompleteness < 0.25 && score === 0) {
      classification = 'insufficient_information';
    } else {
      const t = modelVersion.thresholds;
      classification =
        score >= t.excellent
          ? 'excellent'
          : score >= t.good
            ? 'good'
            : score >= t.possible
              ? 'possible'
              : 'weak';
    }

    for (const c of positive)
      if (c.contribution > 0) explanation.push(`+${c.contribution} ${c.explanation}`);
    if (hardFailures.length > 0)
      explanation.push(`Excluded: ${[...new Set(hardFailures)].join(', ')}`);
    if (inventoryState !== 'verified_available' && candidate.level === 'unit')
      explanation.push(`Inventory ${inventoryState} — unit not confirmed`);
    if (missingPreferences.length > 0)
      explanation.push(`Missing: ${[...new Set(missingPreferences)].join(', ')}`);

    return {
      candidateId: candidate.id,
      level: candidate.level,
      projectId: candidate.projectId,
      projectConfigurationId: candidate.projectConfigurationId,
      inventoryUnitId: candidate.inventoryUnitId,
      eligible,
      score: eligible ? score : 0,
      classification,
      confidence,
      preferenceCompleteness,
      inventoryState,
      unitConfirmedAvailable,
      budgetOutcome,
      hardFailures: [...new Set(hardFailures)],
      positiveComponents: positive,
      negativeComponents: negative,
      missingPreferences: [...new Set(missingPreferences)],
      contradictions,
      reviewRequired,
      reviewReason,
      explanation,
      rank: 0,
    };

    function mk(
      rule: MatchRule,
      contribution: number,
      applied: boolean,
      positiveFlag: boolean,
      skippedReason: string | undefined,
    ): MatchComponent {
      return {
        ruleId: rule.id,
        group: rule.group,
        kind: rule.kind,
        signalKey: rule.signalKey,
        contribution,
        applied,
        positive: positiveFlag,
        skippedReason,
        explanation: rule.explanationTemplate,
      };
    }
  });

  // Rank: eligible first by score desc, stable tie-break by candidateId asc;
  // ineligible/insufficient pushed to the end.
  const ranked = [...results].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
  });
  ranked.forEach((r, i) => (r.rank = i + 1));

  return { rankedCandidates: ranked, modelVersion: modelVersion.version, calculatedAt };
}

function evaluateMatchOperator(
  rule: MatchRule,
  pref: PreferenceValue,
  cand: unknown,
  lead: LeadSnapshot,
  candidate: MatchCandidate,
  now: number,
): boolean {
  const e = rule.expected ?? {};
  switch (rule.operator) {
    case 'boolean_true':
      return cand === true;
    case 'enum_in':
      return (
        typeof cand === 'string' &&
        (e.set ?? (Array.isArray(pref) ? (pref as string[]) : [])).includes(cand)
      );
    case 'numeric_range': {
      if (typeof cand !== 'number') return false;
      return cand >= (e.min ?? -Infinity) && cand <= (e.max ?? Infinity);
    }
    case 'budget_overlap': {
      const r = asRange(pref) ?? { min: lead.budgetMin, max: lead.budgetMax };
      return rangeOverlap(
        r?.min,
        r?.max,
        candidate.advertisedMin ?? candidate.configBaseMin,
        candidate.advertisedMax ?? candidate.configBaseMax,
      );
    }
    case 'area_overlap': {
      const r = asRange(pref);
      const cand2 = cand as { min?: number; max?: number } | undefined;
      return rangeOverlap(r?.min, r?.max, cand2?.min, cand2?.max);
    }
    case 'date_window_overlap': {
      if (typeof cand !== 'string') return false;
      const candTime = new Date(cand).getTime();
      const r = asRange(pref);
      const lo = r?.min ?? -Infinity;
      const hi = r?.max ?? Infinity;
      return candTime >= lo && candTime <= hi;
    }
    case 'distance_threshold': {
      // Only when a trusted distance fact exists on the candidate.
      if (typeof cand !== 'number') return false;
      return cand <= (e.distance ?? Infinity);
    }
    case 'set_intersection':
    case 'preferred_feature': {
      const want = Array.isArray(pref)
        ? (pref as string[])
        : typeof pref === 'string'
          ? [pref]
          : [];
      const have = Array.isArray(cand) ? (cand as string[]) : [];
      return want.some((w) => have.includes(w));
    }
    case 'required_feature': {
      const want = Array.isArray(pref)
        ? (pref as string[])
        : typeof pref === 'string'
          ? [pref]
          : [];
      const have = Array.isArray(cand) ? (cand as string[]) : [];
      return want.every((w) => have.includes(w));
    }
    case 'exclusion': {
      // Matched = NOT excluded (a passing exclusion rule means the candidate is allowed).
      const excluded = Array.isArray(pref)
        ? (pref as string[]).includes(String(cand))
        : pref === cand;
      return !excluded;
    }
    case 'freshness': {
      if (!candidate.unitVerifiedAt) return false;
      const ageDays = (now - new Date(candidate.unitVerifiedAt).getTime()) / 86_400_000;
      return ageDays <= (e.days ?? Infinity);
    }
    case 'missing_value':
      return false;
    case 'review_required':
      return cand === true || pref === true;
  }
}
