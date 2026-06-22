/**
 * Production activation rollout stages and strict website-chat auto-send policy.
 *
 * This module is intentionally policy-first: the model may draft a reply, but
 * the policy engine decides whether the reply could be auto-sent, must go to a
 * human, or must be blocked entirely. It is pure and side-effect free so the
 * same decision logic can be used in shadow evaluation, draft-only review, and
 * future live-send execution.
 */

export const AI_SEND_ROLLOUT_STAGES = [
  'shadow',
  'draft_only',
  'strict_auto',
  'expanded_auto',
] as const;
export type AiSendRolloutStage = (typeof AI_SEND_ROLLOUT_STAGES)[number];

export type AiSendPolicyDecision = 'allow_send' | 'require_human_review' | 'block_send';

export type WebsiteChatPolicyReason =
  | 'shadow_mode'
  | 'draft_only_mode'
  | 'not_grounded'
  | 'knowledge_unapproved'
  | 'inventory_stale'
  | 'pricing_stale'
  | 'consent_required'
  | 'do_not_contact'
  | 'legal_or_compliance'
  | 'complaint_or_sensitive_tone'
  | 'price_negotiation'
  | 'availability_uncertain'
  | 'missing_or_conflicting_knowledge'
  | 'cross_project_risk'
  | 'cross_tenant_risk'
  | 'prompt_injection_risk'
  | 'outside_business_hours'
  | 'weak_confidence'
  | 'weak_retrieval_quality'
  | 'citation_coverage_incomplete'
  | 'human_review_required';

export interface WebsiteChatAutoSendPolicyInput {
  rolloutStage: AiSendRolloutStage;
  grounded: boolean;
  knowledgeApproved: boolean;
  inventoryFresh: boolean;
  pricingFresh: boolean;
  consentAllowed: boolean;
  dncBlocked: boolean;
  legalOrComplianceRisk: boolean;
  complaintOrSensitiveTone: boolean;
  negotiationDetected: boolean;
  availabilityCertain: boolean;
  missingOrConflictingKnowledge: boolean;
  crossProjectRisk: boolean;
  crossTenantRisk: boolean;
  promptInjectionRisk: boolean;
  businessHoursAllowed: boolean;
  humanReviewRequired: boolean;
  confidenceOk: boolean;
  retrievalQualityOk: boolean;
  citationCoverageComplete: boolean;
}

export interface WebsiteChatAutoSendPolicyResult {
  decision: AiSendPolicyDecision;
  reason: WebsiteChatPolicyReason;
  rolloutStage: AiSendRolloutStage;
  blockers: WebsiteChatPolicyReason[];
}

function immediateBlockers(input: WebsiteChatAutoSendPolicyInput): WebsiteChatPolicyReason[] {
  const blockers: WebsiteChatPolicyReason[] = [];
  if (input.dncBlocked) blockers.push('do_not_contact');
  if (!input.consentAllowed) blockers.push('consent_required');
  if (input.legalOrComplianceRisk) blockers.push('legal_or_compliance');
  if (input.crossTenantRisk) blockers.push('cross_tenant_risk');
  if (input.promptInjectionRisk) blockers.push('prompt_injection_risk');
  return blockers;
}

function humanReviewBlockers(input: WebsiteChatAutoSendPolicyInput): WebsiteChatPolicyReason[] {
  const blockers: WebsiteChatPolicyReason[] = [];
  if (!input.grounded) blockers.push('not_grounded');
  if (!input.knowledgeApproved) blockers.push('knowledge_unapproved');
  if (!input.inventoryFresh) blockers.push('inventory_stale');
  if (!input.pricingFresh) blockers.push('pricing_stale');
  if (input.complaintOrSensitiveTone) blockers.push('complaint_or_sensitive_tone');
  if (input.negotiationDetected) blockers.push('price_negotiation');
  if (!input.availabilityCertain) blockers.push('availability_uncertain');
  if (input.missingOrConflictingKnowledge) blockers.push('missing_or_conflicting_knowledge');
  if (input.crossProjectRisk) blockers.push('cross_project_risk');
  if (!input.businessHoursAllowed) blockers.push('outside_business_hours');
  if (!input.confidenceOk) blockers.push('weak_confidence');
  if (!input.retrievalQualityOk) blockers.push('weak_retrieval_quality');
  if (!input.citationCoverageComplete) blockers.push('citation_coverage_incomplete');
  if (input.humanReviewRequired) blockers.push('human_review_required');
  return blockers;
}

export function evaluateWebsiteChatAutoSendPolicy(
  input: WebsiteChatAutoSendPolicyInput,
): WebsiteChatAutoSendPolicyResult {
  if (input.rolloutStage === 'shadow') {
    return {
      decision: 'require_human_review',
      reason: 'shadow_mode',
      rolloutStage: input.rolloutStage,
      blockers: ['shadow_mode'],
    };
  }
  if (input.rolloutStage === 'draft_only') {
    return {
      decision: 'require_human_review',
      reason: 'draft_only_mode',
      rolloutStage: input.rolloutStage,
      blockers: ['draft_only_mode'],
    };
  }

  const hardBlocks = immediateBlockers(input);
  if (hardBlocks.length > 0) {
    return {
      decision: 'block_send',
      reason: hardBlocks[0] ?? 'legal_or_compliance',
      rolloutStage: input.rolloutStage,
      blockers: hardBlocks,
    };
  }

  const humanReview = humanReviewBlockers(input);
  if (humanReview.length > 0) {
    return {
      decision: 'require_human_review',
      reason: humanReview[0] ?? 'human_review_required',
      rolloutStage: input.rolloutStage,
      blockers: humanReview,
    };
  }

  return {
    decision: 'allow_send',
    reason: 'human_review_required',
    rolloutStage: input.rolloutStage,
    blockers: [],
  };
}

/**
 * Map the current tenant policy level into the rollout model used by the
 * production activation design. This lets the repo model future rollout states
 * before the database gains dedicated production-stage columns.
 */
export function rolloutStageForOperatingLevel(
  operatingLevel: 'disabled' | 'shadow' | 'copilot' | 'automatic' | null | undefined,
): AiSendRolloutStage {
  switch (operatingLevel) {
    case 'shadow':
      return 'shadow';
    case 'copilot':
      return 'draft_only';
    case 'automatic':
      return 'strict_auto';
    case 'disabled':
    default:
      return 'shadow';
  }
}
