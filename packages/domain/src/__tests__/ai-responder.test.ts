import { describe, it, expect } from 'vitest';
import {
  decideResponderOutcome,
  RESPONDER_LIVE_SENDING,
  type ResponderContext,
} from '../ai-responder';

const allOpen = (over: Partial<ResponderContext> = {}): ResponderContext => ({
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

describe('responder live-send gate', () => {
  it('live sending is OFF in this phase', () => {
    expect(RESPONDER_LIVE_SENDING).toBe(false);
  });

  it('NEVER delivers, for any input combination', () => {
    const variants: Partial<ResponderContext>[] = [
      {},
      { operatingMode: 'ai', takeoverActive: false },
      { grounding: 'grounded', hasCandidate: true },
      { dncBlocked: false, consentWithdrawn: false },
    ];
    for (const v of variants) {
      const d = decideResponderOutcome(allOpen(v));
      expect(d.delivered).toBe(false);
      expect(d.outcome).not.toBe('deliver');
    }
  });

  it('a fully-open, grounded context is SUPPRESSED with the Phase-5B reason (not sent)', () => {
    const d = decideResponderOutcome(allOpen());
    expect(d.outcome).toBe('suppressed');
    expect(d.reason).toBe('phase_5b_automatic_responder_not_enabled');
    expect(d.delivered).toBe(false);
    expect(d.liveSendingEnabled).toBe(false);
  });
});

describe('responder send gates', () => {
  it('blocks when a hard send gate fails', () => {
    expect(decideResponderOutcome(allOpen({ operatingMode: 'human' })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ takeoverActive: true })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ lifecycle: 'closed' })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ dncBlocked: true })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ consentWithdrawn: true })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ tenantAiEnabled: false })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ projectAiApproved: false })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ dailyLimitReached: true })).outcome).toBe('blocked');
    expect(decideResponderOutcome(allOpen({ providerAvailable: false })).outcome).toBe('blocked');
  });

  it('reports the failing gate(s) and never delivers when blocked', () => {
    const d = decideResponderOutcome(allOpen({ dncBlocked: true, takeoverActive: true }));
    expect(d.blockers).toContain('do_not_contact');
    expect(d.blockers).toContain('human_takeover_active');
    expect(d.delivered).toBe(false);
  });

  it('escalates (never guesses) when gates pass but the answer is not grounded', () => {
    for (const g of [
      'insufficient_evidence',
      'conflicting_evidence',
      'stale_dynamic_data',
      'unsupported_question',
      'policy_blocked',
      'human_review_required',
    ] as const) {
      const d = decideResponderOutcome(allOpen({ grounding: g }));
      expect(d.outcome).toBe('escalate');
      expect(d.reason).toBe(`escalate:${g}`);
      expect(d.delivered).toBe(false);
    }
  });

  it('escalates when grounded but no candidate reply exists', () => {
    const d = decideResponderOutcome(allOpen({ hasCandidate: false }));
    expect(d.outcome).toBe('escalate');
    expect(d.blockers).toContain('no_candidate');
  });

  it('respects the explicit policy layer above grounding', () => {
    const blocked = decideResponderOutcome(
      allOpen({
        autoSendPolicyDecision: 'block_send',
        autoSendPolicyReason: 'do_not_contact',
      }),
    );
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.blockers).toContain('policy_block_send');

    const review = decideResponderOutcome(
      allOpen({
        autoSendPolicyDecision: 'require_human_review',
        autoSendPolicyReason: 'price_negotiation',
      }),
    );
    expect(review.outcome).toBe('escalate');
    expect(review.blockers).toContain('policy_requires_human_review');
  });
});
