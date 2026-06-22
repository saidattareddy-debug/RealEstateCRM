import { describe, it, expect } from 'vitest';
import {
  decideResponderOutcome,
  summarizeResponderRun,
  type ResponderContext,
  type ResponderDecision,
} from '../ai-responder';
import type { GroundingDecision } from '../grounding';
import type { OperatingMode } from '../ai-guard';

/**
 * Responder safety evaluation harness (no live send).
 *
 * Rather than a handful of hand-picked cases, this enumerates a large matrix of
 * gate + grounding combinations and asserts the safety invariants hold for ALL
 * of them: the responder never delivers, grounded+open → suppressed,
 * not-grounded → escalate, any failed gate → blocked.
 */

const GROUNDINGS: GroundingDecision[] = [
  'grounded',
  'insufficient_evidence',
  'conflicting_evidence',
  'stale_dynamic_data',
  'unsupported_question',
  'policy_blocked',
  'human_review_required',
];

const OPERATING_MODES: OperatingMode[] = ['human', 'paused', 'ai'];

const base = (over: Partial<ResponderContext> = {}): ResponderContext => ({
  operatingMode: 'ai',
  takeoverActive: false,
  lifecycle: 'open',
  dncBlocked: false,
  consentWithdrawn: false,
  platformAiEnabled: true,
  tenantAiEnabled: true,
  projectAiApproved: true,
  channelPolicyAllows: true,
  providerAvailable: true,
  dailyLimitReached: false,
  modelConfigured: true,
  knowledgeApproved: true,
  grounding: 'grounded',
  hasCandidate: true,
  ...over,
});

// Boolean send-gates: toggling any one of these to its blocking value must block.
const BOOLEAN_GATES: { key: keyof ResponderContext; block: boolean }[] = [
  { key: 'takeoverActive', block: true },
  { key: 'dncBlocked', block: true },
  { key: 'consentWithdrawn', block: true },
  { key: 'platformAiEnabled', block: false },
  { key: 'tenantAiEnabled', block: false },
  { key: 'projectAiApproved', block: false },
  { key: 'channelPolicyAllows', block: false },
  { key: 'providerAvailable', block: false },
  { key: 'dailyLimitReached', block: true },
  { key: 'modelConfigured', block: false },
  { key: 'knowledgeApproved', block: false },
];

function buildMatrix(): ResponderContext[] {
  const ctxs: ResponderContext[] = [];
  // 1. Operating mode × grounding (gates otherwise open).
  for (const operatingMode of OPERATING_MODES) {
    for (const grounding of GROUNDINGS) {
      ctxs.push(base({ operatingMode, grounding, hasCandidate: grounding === 'grounded' }));
    }
  }
  // 2. Each boolean gate flipped to its blocking value, otherwise fully open.
  for (const g of BOOLEAN_GATES) {
    ctxs.push(base({ [g.key]: g.block } as Partial<ResponderContext>));
  }
  // 3. Grounded + open but no candidate.
  ctxs.push(base({ hasCandidate: false }));
  return ctxs;
}

describe('responder evaluation harness (safety)', () => {
  const matrix = buildMatrix();
  const decisions: ResponderDecision[] = matrix.map(decideResponderOutcome);

  it('covers a broad matrix of scenarios', () => {
    expect(matrix.length).toBeGreaterThanOrEqual(30);
  });

  it('NEVER delivers across the entire matrix (headline safety metric)', () => {
    const summary = summarizeResponderRun(decisions);
    expect(summary.total).toBe(decisions.length);
    expect(summary.delivered).toBe(0);
    expect(summary.safe).toBe(true);
    // Every individual decision agrees.
    for (const d of decisions) {
      expect(d.delivered).toBe(false);
      expect(d.outcome).not.toBe('deliver');
    }
  });

  it('outcome counts partition the matrix exactly', () => {
    const s = summarizeResponderRun(decisions);
    expect(s.suppressed + s.escalate + s.blocked).toBe(s.total);
  });

  it('grounded + all gates open → suppressed (never sent)', () => {
    const d = decideResponderOutcome(base());
    expect(d.outcome).toBe('suppressed');
    expect(d.reason).toBe('phase_5b_automatic_responder_not_enabled');
  });

  it('gates open but answer not grounded → escalate', () => {
    for (const grounding of GROUNDINGS.filter((g) => g !== 'grounded')) {
      const d = decideResponderOutcome(base({ grounding, hasCandidate: false }));
      expect(d.outcome).toBe('escalate');
    }
  });

  it('any failing send gate → blocked', () => {
    for (const g of BOOLEAN_GATES) {
      const d = decideResponderOutcome(base({ [g.key]: g.block } as Partial<ResponderContext>));
      expect(d.outcome).toBe('blocked');
    }
    // Non-AI operating modes are blocked regardless of grounding.
    expect(decideResponderOutcome(base({ operatingMode: 'human' })).outcome).toBe('blocked');
    expect(decideResponderOutcome(base({ operatingMode: 'paused' })).outcome).toBe('blocked');
  });

  it('summarizeResponderRun flags an (impossible) delivered decision as unsafe', () => {
    // Defensive: if a delivered decision ever appeared, the summary must catch it.
    const tampered = {
      outcome: 'deliver',
      reason: 'x',
      liveSendingEnabled: true,
      blockers: [],
      delivered: false,
    } as unknown as ResponderDecision;
    expect(summarizeResponderRun([tampered]).safe).toBe(false);
  });
});
