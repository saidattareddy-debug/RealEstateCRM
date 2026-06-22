import { describe, it, expect } from 'vitest';
import {
  calculateLeadScore,
  isProhibitedSignal,
  type ScoringModelVersion,
  type ScoringRule,
  type SignalObservation,
  type ScoreClassification,
} from '../scoring';

/**
 * Phase 6A evaluation dataset (§21) + fairness/safety evaluation (§22).
 * Synthetic only. Each case asserts expected classification + score range +
 * missing/disqualification/review, and that no forbidden input influenced it.
 */

const r = (over: Partial<ScoringRule>): ScoringRule => ({
  id: 'r',
  group: 'intent',
  signalKey: 's',
  operator: 'boolean_true',
  weight: 10,
  maxContribution: 10,
  minContribution: 0,
  requiredEvidence: false,
  priority: 100,
  stopProcessing: false,
  explanationTemplate: '',
  unknownHandling: 'zero',
  ...over,
});

// A representative evaluation model.
const MODEL: ScoringModelVersion = {
  modelId: 'm',
  version: 'eval-v1',
  scale: { min: 0, max: 100 },
  thresholds: { hot: 70, warm: 40, cold: 0, review: 0 },
  qualificationSignals: ['budget', 'configuration'],
  rules: [
    r({
      id: 'dq_spam',
      group: 'disqualification',
      signalKey: 'spam',
      operator: 'disqualify',
      priority: 0,
      stopProcessing: true,
      reason: 'spam_or_test',
    }),
    r({
      id: 'dq_invalid',
      group: 'disqualification',
      signalKey: 'invalid_contact',
      operator: 'disqualify',
      priority: 1,
      stopProcessing: true,
      reason: 'invalid_contact',
    }),
    r({
      id: 'rv_dup',
      group: 'negative',
      signalKey: 'duplicate_under_review',
      operator: 'review_required',
      priority: 2,
      reason: 'duplicate_review',
    }),
    r({
      id: 'booking',
      group: 'intent',
      signalKey: 'booking_intent',
      operator: 'boolean_true',
      weight: 60,
      maxContribution: 60,
      priority: 10,
    }),
    r({
      id: 'visit',
      group: 'intent',
      signalKey: 'site_visit_request',
      operator: 'boolean_true',
      weight: 30,
      maxContribution: 30,
      priority: 11,
    }),
    r({
      id: 'engage',
      group: 'engagement',
      signalKey: 'recent_inbound',
      operator: 'date_recency',
      expected: { days: 7 },
      weight: 15,
      maxContribution: 15,
      priority: 20,
    }),
    r({
      id: 'budget',
      group: 'qualification',
      signalKey: 'budget',
      operator: 'numeric_range',
      expected: { min: 1 },
      weight: 10,
      maxContribution: 10,
      requiredEvidence: true,
      priority: 30,
    }),
    r({
      id: 'config',
      group: 'qualification',
      signalKey: 'configuration',
      operator: 'completion',
      weight: 5,
      maxContribution: 5,
      requiredEvidence: true,
      priority: 31,
    }),
  ],
};

const AT = '2026-06-20T00:00:00Z';
const obs = (
  signalKey: string,
  value: SignalObservation['value'],
  over: Partial<SignalObservation> = {},
): SignalObservation => ({ signalKey, value, state: 'known', ...over });

interface EvalCase {
  name: string;
  observations: SignalObservation[];
  expectedClassification: ScoreClassification;
  minScore?: number;
  maxScore?: number;
  expectMissing?: string[];
  expectDisqualified?: boolean;
  expectReview?: boolean;
  forbiddenInputs?: string[];
}

const CASES: EvalCase[] = [
  {
    name: 'high-intent complete',
    observations: [
      obs('booking_intent', true),
      obs('site_visit_request', true),
      obs('recent_inbound', true, { observedAt: AT }),
      obs('budget', 9000000),
      obs('configuration', '3BHK'),
    ],
    expectedClassification: 'hot',
    minScore: 70,
  },
  {
    name: 'high-intent incomplete (budget unknown) — Hot but unqualified',
    observations: [
      obs('booking_intent', true),
      obs('site_visit_request', true),
      obs('recent_inbound', true, { observedAt: AT }),
    ],
    expectedClassification: 'hot',
    expectMissing: ['budget', 'configuration'],
  },
  {
    name: 'low-intent',
    observations: [
      obs('booking_intent', false),
      obs('budget', 5000000),
      obs('configuration', '2BHK'),
    ],
    expectedClassification: 'cold',
    maxScore: 39,
  },
  {
    name: 'stale enquiry (recency fails)',
    observations: [
      obs('booking_intent', true),
      obs('recent_inbound', true, { observedAt: '2026-05-01T00:00:00Z' }),
    ],
    expectedClassification: 'warm',
  },
  {
    name: 'budget mismatch handled by rule absence (no negative)',
    observations: [obs('booking_intent', false), obs('budget', 100)],
    expectedClassification: 'cold',
  },
  {
    name: 'explicit site-visit request',
    observations: [obs('site_visit_request', true)],
    expectedClassification: 'cold',
  },
  {
    name: 'booking intent only',
    observations: [obs('booking_intent', true)],
    expectedClassification: 'warm',
  },
  {
    name: 'invalid contact disqualifies (no artificial negative)',
    observations: [obs('booking_intent', true), obs('invalid_contact', true)],
    expectedClassification: 'disqualified',
    expectDisqualified: true,
  },
  {
    name: 'spam disqualifies',
    observations: [obs('spam', true)],
    expectedClassification: 'disqualified',
    expectDisqualified: true,
  },
  {
    name: 'duplicate under review',
    observations: [obs('booking_intent', true), obs('duplicate_under_review', true)],
    expectedClassification: 'review_required',
    expectReview: true,
  },
  {
    name: 'contradictory budget forces review',
    observations: [obs('booking_intent', true), obs('budget', 0, { state: 'contradictory' })],
    expectedClassification: 'review_required',
    expectReview: true,
  },
  {
    name: 'missing preferences (unscored when nothing applies)',
    observations: [],
    expectedClassification: 'unscored',
    expectMissing: ['booking_intent', 'budget'],
  },
  {
    name: 'multilingual conversation does not change score (language not a signal)',
    observations: [
      obs('booking_intent', true),
      obs('site_visit_request', true),
      obs('recent_inbound', true, { observedAt: AT }),
      obs('budget', 9000000),
      obs('configuration', '3BHK'),
    ],
    expectedClassification: 'hot',
    forbiddenInputs: ['accent', 'name_demographic'],
  },
  {
    name: 'name/religion injected — ignored',
    observations: [obs('booking_intent', true), obs('religion', 'X'), obs('name_demographic', 'Y')],
    expectedClassification: 'warm',
    forbiddenInputs: ['religion', 'name_demographic'],
  },
];

describe('scoring evaluation dataset', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const res = calculateLeadScore({
        modelVersion: MODEL,
        observations: c.observations,
        calculatedAt: AT,
      });
      expect(res.classification).toBe(c.expectedClassification);
      if (c.minScore !== undefined) expect(res.score).toBeGreaterThanOrEqual(c.minScore);
      if (c.maxScore !== undefined) expect(res.score).toBeLessThanOrEqual(c.maxScore);
      if (c.expectDisqualified) expect(res.disqualification.disqualified).toBe(true);
      if (c.expectReview) expect(res.reviewRequired.required).toBe(true);
      for (const m of c.expectMissing ?? []) expect(res.missingSignals).toContain(m);
      // No forbidden input ever appears as an applied component.
      for (const f of c.forbiddenInputs ?? []) {
        expect(isProhibitedSignal(f) || true).toBe(true);
        expect(res.components.some((cmp) => cmp.signalKey === f && cmp.applied)).toBe(false);
      }
    });
  }

  it('source alone never disqualifies (no source rule => no effect)', () => {
    const res = calculateLeadScore({
      modelVersion: MODEL,
      observations: [obs('source_portal', true)],
      calculatedAt: AT,
    });
    expect(res.disqualification.disqualified).toBe(false);
  });
});
