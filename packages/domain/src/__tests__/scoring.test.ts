import { describe, it, expect } from 'vitest';
import {
  calculateLeadScore,
  assertNoProhibitedSignals,
  isProhibitedSignal,
  effectiveScore,
  validateThresholds,
  PROHIBITED_SIGNAL_KEYS,
  type ScoringModelVersion,
  type ScoringRule,
  type SignalObservation,
} from '../scoring';

const rule = (over: Partial<ScoringRule>): ScoringRule => ({
  id: 'r',
  group: 'intent',
  signalKey: 's',
  operator: 'boolean_true',
  weight: 10,
  maxContribution: 10,
  minContribution: 0,
  requiredEvidence: false,
  priority: 1,
  stopProcessing: false,
  explanationTemplate: 'rule',
  unknownHandling: 'zero',
  ...over,
});

const model = (
  rules: ScoringRule[],
  over: Partial<ScoringModelVersion> = {},
): ScoringModelVersion => ({
  modelId: 'm1',
  version: 'v1',
  scale: { min: 0, max: 100 },
  thresholds: { hot: 70, warm: 40, cold: 0, review: 0 },
  rules,
  ...over,
});

const obs = (
  signalKey: string,
  value: SignalObservation['value'],
  over: Partial<SignalObservation> = {},
): SignalObservation => ({
  signalKey,
  value,
  state: 'known',
  ...over,
});

const AT = '2026-06-20T00:00:00Z';

describe('determinism & reproducibility', () => {
  it('identical inputs yield identical results', () => {
    const m = model([
      rule({ id: 'a', signalKey: 'booking_intent', weight: 80, maxContribution: 80 }),
    ]);
    const o = [obs('booking_intent', true)];
    const r1 = calculateLeadScore({ modelVersion: m, observations: o, calculatedAt: AT });
    const r2 = calculateLeadScore({ modelVersion: m, observations: o, calculatedAt: AT });
    expect(r1).toEqual(r2);
  });

  it('rules apply in deterministic order (priority, then id)', () => {
    const m = model([
      rule({ id: 'b', priority: 2, signalKey: 'x', weight: 5, maxContribution: 5 }),
      rule({ id: 'a', priority: 1, signalKey: 'x', weight: 5, maxContribution: 5 }),
    ]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('x', true)],
      calculatedAt: AT,
    });
    expect(r.appliedRules).toEqual(['a', 'b']);
  });
});

describe('classification', () => {
  const m = model([
    rule({ id: 'a', signalKey: 'booking_intent', weight: 80, maxContribution: 80 }),
  ]);
  it('hot when above hot threshold', () => {
    expect(
      calculateLeadScore({
        modelVersion: m,
        observations: [obs('booking_intent', true)],
        calculatedAt: AT,
      }).classification,
    ).toBe('hot');
  });
  it('cold when below warm threshold', () => {
    const m2 = model([
      rule({ id: 'a', signalKey: 'booking_intent', weight: 10, maxContribution: 10 }),
    ]);
    expect(
      calculateLeadScore({
        modelVersion: m2,
        observations: [obs('booking_intent', true)],
        calculatedAt: AT,
      }).classification,
    ).toBe('cold');
  });
  it('unscored when no rule applied and signals missing', () => {
    expect(
      calculateLeadScore({ modelVersion: m, observations: [], calculatedAt: AT }).classification,
    ).toBe('unscored');
  });
});

describe('missing data is safe (zero, not negative; never disqualifies)', () => {
  it('unknown contributes zero, reduces evidence completeness, lists missing', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'budget',
        operator: 'numeric_range',
        expected: { min: 1 },
        weight: 50,
        maxContribution: 50,
        requiredEvidence: true,
      }),
    ]);
    const r = calculateLeadScore({ modelVersion: m, observations: [], calculatedAt: AT });
    expect(r.score).toBe(0);
    expect(r.disqualification.disqualified).toBe(false);
    expect(r.missingSignals).toContain('budget');
    expect(r.evidenceCompleteness).toBe(0);
  });

  it('high intent + unknown budget => can be Hot but qualification incomplete', () => {
    const m = model(
      [
        rule({
          id: 'a',
          group: 'intent',
          signalKey: 'booking_intent',
          weight: 80,
          maxContribution: 80,
        }),
        rule({
          id: 'b',
          group: 'qualification',
          signalKey: 'budget',
          operator: 'numeric_range',
          expected: { min: 1 },
          weight: 0,
          maxContribution: 0,
          requiredEvidence: true,
        }),
      ],
      { qualificationSignals: ['budget'] },
    );
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('booking_intent', true)],
      calculatedAt: AT,
    });
    expect(r.classification).toBe('hot');
    expect(r.qualificationComplete).toBe(false);
  });

  it('complete details but no intent stays Cold', () => {
    const m = model([
      rule({
        id: 'a',
        group: 'intent',
        signalKey: 'booking_intent',
        weight: 80,
        maxContribution: 80,
      }),
      rule({
        id: 'b',
        group: 'fit',
        signalKey: 'budget',
        operator: 'numeric_range',
        expected: { min: 1 },
        weight: 5,
        maxContribution: 5,
      }),
    ]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('booking_intent', false), obs('budget', 5000000)],
      calculatedAt: AT,
    });
    expect(r.classification).toBe('cold');
  });
});

describe('signal states', () => {
  it('contradictory critical fact forces review', () => {
    const m = model([
      rule({ id: 'a', signalKey: 'budget', operator: 'numeric_range', expected: { min: 1 } }),
    ]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('budget', 0, { state: 'contradictory' })],
      calculatedAt: AT,
    });
    expect(r.reviewRequired.required).toBe(true);
    expect(r.contradictions).toContain('budget');
  });
  it('stale evidence is flagged and does not contribute', () => {
    const m = model([rule({ id: 'a', signalKey: 'x', weight: 50, maxContribution: 50 })]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('x', true, { state: 'stale' })],
      calculatedAt: AT,
    });
    expect(r.score).toBe(0);
    expect(r.calculationConfidence).toBeLessThan(1);
  });
});

describe('caps, bounds, normalization', () => {
  it('group caps limit contribution', () => {
    const m = model(
      [
        rule({ id: 'a', group: 'intent', signalKey: 'x', weight: 60, maxContribution: 60 }),
        rule({ id: 'b', group: 'intent', signalKey: 'y', weight: 60, maxContribution: 60 }),
      ],
      { groupCaps: { intent: 50 } },
    );
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('x', true), obs('y', true)],
      calculatedAt: AT,
    });
    expect(r.score).toBe(50);
  });
  it('score clamps to scale', () => {
    const m = model([rule({ id: 'a', signalKey: 'x', weight: 999, maxContribution: 999 })]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('x', true)],
      calculatedAt: AT,
    });
    expect(r.score).toBe(100);
  });
});

describe('disqualification', () => {
  it('disqualifies with an explicit reason and no artificial negative score', () => {
    const m = model([
      rule({
        id: 'a',
        group: 'disqualification',
        signalKey: 'spam',
        operator: 'disqualify',
        reason: 'spam_or_test',
        stopProcessing: true,
      }),
    ]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('spam', true)],
      calculatedAt: AT,
    });
    expect(r.classification).toBe('disqualified');
    expect(r.disqualification.reason).toBe('spam_or_test');
    expect(r.score).toBe(0);
  });
});

describe('fairness — prohibited signals', () => {
  it('exposes the prohibited catalogue', () => {
    expect(PROHIBITED_SIGNAL_KEYS).toContain('religion');
    expect(isProhibitedSignal('caste')).toBe(true);
  });
  it('rejects a model that scores on a prohibited signal', () => {
    expect(() => assertNoProhibitedSignals([rule({ id: 'a', signalKey: 'religion' })])).toThrow(
      /prohibited_signal_in_rules/,
    );
  });
  it('ignores prohibited observations even if injected', () => {
    const m = model([rule({ id: 'a', signalKey: 'religion', weight: 90, maxContribution: 90 })]);
    const r = calculateLeadScore({
      modelVersion: m,
      observations: [obs('religion', true)],
      calculatedAt: AT,
    });
    // The rule never contributes; the prohibited observation is dropped.
    expect(r.score).toBe(0);
  });
  it('name / language alone do not change score (no rule consumes them)', () => {
    const m = model([
      rule({ id: 'a', signalKey: 'booking_intent', weight: 80, maxContribution: 80 }),
    ]);
    const withName = calculateLeadScore({
      modelVersion: m,
      observations: [obs('booking_intent', true), obs('name_demographic', 'X')],
      calculatedAt: AT,
    });
    const without = calculateLeadScore({
      modelVersion: m,
      observations: [obs('booking_intent', true)],
      calculatedAt: AT,
    });
    expect(withName.score).toBe(without.score);
  });
});

describe('overrides', () => {
  const m = model([rule({ id: 'a', signalKey: 'x', weight: 30, maxContribution: 30 })]);
  const result = calculateLeadScore({
    modelVersion: m,
    observations: [obs('x', true)],
    calculatedAt: AT,
  });

  it('applies an active override while preserving the calculated value', () => {
    const eff = effectiveScore(
      result,
      { score: 90, reason: 'manager', actorId: 'u1', appliedAt: AT },
      AT,
    );
    expect(eff.calculatedScore).toBe(30);
    expect(eff.effectiveScore).toBe(90);
    expect(eff.overrideActive).toBe(true);
  });
  it('an expired override ceases to affect the effective score', () => {
    const eff = effectiveScore(
      result,
      { score: 90, reason: 'm', actorId: 'u1', appliedAt: AT, expiresAt: '2026-06-19T00:00:00Z' },
      AT,
    );
    expect(eff.overrideActive).toBe(false);
    expect(eff.effectiveScore).toBe(30);
  });
});

describe('threshold validation', () => {
  it('rejects out-of-order thresholds', () => {
    expect(
      validateThresholds({ hot: 40, warm: 70, cold: 0, review: 0 }, { min: 0, max: 100 }).ok,
    ).toBe(false);
  });
  it('accepts ordered thresholds', () => {
    expect(
      validateThresholds({ hot: 70, warm: 40, cold: 10, review: 5 }, { min: 0, max: 100 }).ok,
    ).toBe(true);
  });
});
