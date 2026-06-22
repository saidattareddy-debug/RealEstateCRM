import { describe, expect, it } from 'vitest';
import {
  evaluateWebsiteChatAutoSendPolicy,
  rolloutStageForOperatingLevel,
  type WebsiteChatAutoSendPolicyInput,
} from '../ai-send-policy';

const base = (
  over: Partial<WebsiteChatAutoSendPolicyInput> = {},
): WebsiteChatAutoSendPolicyInput => ({
  rolloutStage: 'strict_auto',
  grounded: true,
  knowledgeApproved: true,
  inventoryFresh: true,
  pricingFresh: true,
  consentAllowed: true,
  dncBlocked: false,
  legalOrComplianceRisk: false,
  complaintOrSensitiveTone: false,
  negotiationDetected: false,
  availabilityCertain: true,
  missingOrConflictingKnowledge: false,
  crossProjectRisk: false,
  crossTenantRisk: false,
  promptInjectionRisk: false,
  businessHoursAllowed: true,
  humanReviewRequired: false,
  confidenceOk: true,
  retrievalQualityOk: true,
  citationCoverageComplete: true,
  ...over,
});

describe('evaluateWebsiteChatAutoSendPolicy', () => {
  it('never auto-sends in shadow or draft-only modes', () => {
    expect(evaluateWebsiteChatAutoSendPolicy(base({ rolloutStage: 'shadow' })).decision).toBe(
      'require_human_review',
    );
    expect(evaluateWebsiteChatAutoSendPolicy(base({ rolloutStage: 'draft_only' })).decision).toBe(
      'require_human_review',
    );
  });

  it('blocks hard-stop safety violations', () => {
    expect(evaluateWebsiteChatAutoSendPolicy(base({ dncBlocked: true })).decision).toBe(
      'block_send',
    );
    expect(evaluateWebsiteChatAutoSendPolicy(base({ legalOrComplianceRisk: true })).reason).toBe(
      'legal_or_compliance',
    );
    expect(evaluateWebsiteChatAutoSendPolicy(base({ crossTenantRisk: true })).reason).toBe(
      'cross_tenant_risk',
    );
  });

  it('routes uncertain or risky sales cases to human review', () => {
    expect(evaluateWebsiteChatAutoSendPolicy(base({ negotiationDetected: true })).decision).toBe(
      'require_human_review',
    );
    expect(evaluateWebsiteChatAutoSendPolicy(base({ inventoryFresh: false })).reason).toBe(
      'inventory_stale',
    );
    expect(
      evaluateWebsiteChatAutoSendPolicy(base({ citationCoverageComplete: false })).reason,
    ).toBe('citation_coverage_incomplete');
  });

  it('allows a low-risk grounded reply only in auto-send stages', () => {
    const strict = evaluateWebsiteChatAutoSendPolicy(base({ rolloutStage: 'strict_auto' }));
    const expanded = evaluateWebsiteChatAutoSendPolicy(base({ rolloutStage: 'expanded_auto' }));
    expect(strict.decision).toBe('allow_send');
    expect(expanded.decision).toBe('allow_send');
  });
});

describe('rolloutStageForOperatingLevel', () => {
  it('maps current tenant policy levels into rollout stages', () => {
    expect(rolloutStageForOperatingLevel('shadow')).toBe('shadow');
    expect(rolloutStageForOperatingLevel('copilot')).toBe('draft_only');
    expect(rolloutStageForOperatingLevel('automatic')).toBe('strict_auto');
    expect(rolloutStageForOperatingLevel('disabled')).toBe('shadow');
    expect(rolloutStageForOperatingLevel(null)).toBe('shadow');
  });
});
