/**
 * Deterministic grounding decision (Phase 5A §12). Never relies on a model's
 * self-reported confidence — the decision is computed from the retrieval
 * evidence alone. A project-specific answer may proceed to a DRAFT only when the
 * decision is `grounded`; otherwise the system produces an escalation draft, not
 * a guessed answer.
 */

export type GroundingDecision =
  | 'grounded'
  | 'insufficient_evidence'
  | 'conflicting_evidence'
  | 'stale_dynamic_data'
  | 'unsupported_question'
  | 'policy_blocked'
  | 'human_review_required';

export interface GroundingEvidence {
  /** Independent approved sources judged relevant to the question. */
  relevantApprovedSources: number;
  /** Best retrieval relevance score in [0,1]. */
  topRelevance: number;
  /** An exact approved-FAQ match was found. */
  exactFaqMatch: boolean;
  /** A structured dynamic tool returned verified evidence. */
  structuredToolEvidence: boolean;
  /** A conflict was detected among the evidence. */
  conflictDetected: boolean;
  /** Dynamic operational data (e.g. inventory) is stale. */
  dynamicDataStale: boolean;
  /** The question is project-specific (vs general real-estate). */
  projectSpecific: boolean;
  /** The conversation/answer project scope matched the evidence. */
  projectScopeMatch: boolean;
  /** The requested language can be served (same-language or allowed fallback). */
  languageSupported: boolean;
  /** A policy block applies (e.g. legal/financial guarantee request). */
  policyBlocked: boolean;
  /** Required citation categories are all covered by the evidence. */
  citationCoverageComplete: boolean;
}

export interface GroundingConfig {
  minRelevantSources?: number; // default 1
  minTopRelevance?: number; // default 0.45
}

export function decideGrounding(
  e: GroundingEvidence,
  config: GroundingConfig = {},
): GroundingDecision {
  const minSources = config.minRelevantSources ?? 1;
  const minRelevance = config.minTopRelevance ?? 0.45;

  if (e.policyBlocked) return 'policy_blocked';
  if (!e.languageSupported) return 'human_review_required';
  if (e.projectSpecific && !e.projectScopeMatch) return 'human_review_required';
  if (e.conflictDetected) return 'conflicting_evidence';
  if (e.dynamicDataStale) return 'stale_dynamic_data';

  const hasStrongEvidence =
    e.exactFaqMatch ||
    e.structuredToolEvidence ||
    (e.relevantApprovedSources >= minSources && e.topRelevance >= minRelevance);

  if (!hasStrongEvidence) {
    // No approved evidence at all for a project question → unsupported.
    if (e.projectSpecific && e.relevantApprovedSources === 0 && !e.structuredToolEvidence) {
      return 'unsupported_question';
    }
    return 'insufficient_evidence';
  }
  if (!e.citationCoverageComplete) return 'insufficient_evidence';
  return 'grounded';
}

/** A draft may be produced only for a grounded decision. */
export function mayDraftAnswer(decision: GroundingDecision): boolean {
  return decision === 'grounded';
}

/** Evidence sufficiency score in [0,1] for tracing/thresholds. */
export function evidenceSufficiency(e: GroundingEvidence): number {
  let score = 0;
  if (e.exactFaqMatch) score += 0.5;
  if (e.structuredToolEvidence) score += 0.3;
  score += Math.min(0.4, e.relevantApprovedSources * 0.15);
  score += Math.min(0.3, e.topRelevance * 0.3);
  if (e.conflictDetected) score -= 0.4;
  if (e.dynamicDataStale) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}
