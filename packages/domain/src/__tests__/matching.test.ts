import { describe, it, expect } from 'vitest';
import {
  calculateProjectMatches,
  assertNoProhibitedMatchInputs,
  validateExtractionProposal,
  buildExtractionIdempotencyKey,
  type MatchModelVersion,
  type MatchRule,
  type MatchCandidate,
  type LeadSnapshot,
} from '../matching';

const rule = (over: Partial<MatchRule>): MatchRule => ({
  id: 'r',
  group: 'configuration',
  kind: 'soft',
  operator: 'boolean_true',
  signalKey: 's',
  candidateField: 'f',
  weight: 20,
  maxContribution: 20,
  missingHandling: 'zero',
  priority: 100,
  explanationTemplate: 'rule',
  ...over,
});

const model = (rules: MatchRule[], over: Partial<MatchModelVersion> = {}): MatchModelVersion => ({
  modelId: 'm',
  version: 'v1',
  scale: { min: 0, max: 100 },
  thresholds: { excellent: 70, good: 50, possible: 30, weak: 0 },
  rules,
  freshnessWindowDays: 7,
  preferenceSignals: ['budget', 'configuration'],
  ...over,
});

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: 'c1',
  level: 'project',
  tenantId: 't1',
  projectId: 'p1',
  inTenant: true,
  projectActive: true,
  projectApproved: true,
  projectVisible: true,
  saleApplicable: true,
  propertyCategoryAllowed: true,
  excludedByLead: false,
  fields: {},
  ...over,
});

const lead = (over: Partial<LeadSnapshot> = {}): LeadSnapshot => ({
  preferences: {},
  ...over,
});

const AT = '2026-06-20T00:00:00Z';

describe('determinism & ranking', () => {
  it('is reproducible', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'configuration',
        candidateField: 'config',
        operator: 'boolean_true',
      }),
    ]);
    const c = [candidate({ fields: { config: true } })];
    const l = lead({ preferences: { configuration: true } });
    const r1 = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: c,
      calculatedAt: AT,
    });
    const r2 = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: c,
      calculatedAt: AT,
    });
    expect(r1).toEqual(r2);
  });

  it('stable tie-break by candidateId, eligible before ineligible', () => {
    const m = model([rule({ id: 'a', signalKey: 'configuration', candidateField: 'config' })]);
    const l = lead({ preferences: { configuration: true } });
    const c = [
      candidate({ id: 'c2', fields: { config: true } }),
      candidate({ id: 'c1', fields: { config: true } }),
      candidate({ id: 'c3', projectApproved: false, fields: { config: true } }),
    ];
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: c,
      calculatedAt: AT,
    });
    expect(r.rankedCandidates.map((x) => x.candidateId)).toEqual(['c1', 'c2', 'c3']);
    expect(r.rankedCandidates[2]!.classification).toBe('ineligible');
  });
});

describe('eligibility / candidate generation safety', () => {
  it('cross-tenant / inactive / unapproved / invisible candidates are ineligible (not ranked among eligible)', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'configuration',
        candidateField: 'config',
        weight: 80,
        maxContribution: 80,
      }),
    ]);
    const l = lead({ preferences: { configuration: true } });
    for (const bad of [
      { inTenant: false },
      { projectActive: false },
      { projectApproved: false },
      { projectVisible: false },
      { saleApplicable: false },
      { propertyCategoryAllowed: false },
      { excludedByLead: true },
    ]) {
      const r = calculateProjectMatches({
        modelVersion: m,
        leadSnapshot: l,
        candidates: [candidate({ ...bad, fields: { config: true } })],
        calculatedAt: AT,
      });
      expect(r.rankedCandidates[0]!.eligible).toBe(false);
      expect(r.rankedCandidates[0]!.classification).toBe('ineligible');
      expect(r.rankedCandidates[0]!.score).toBe(0);
    }
  });
});

describe('hard vs soft', () => {
  it('a failed hard constraint makes the candidate ineligible regardless of soft score', () => {
    const m = model([
      rule({
        id: 'hard',
        kind: 'hard',
        group: 'property_type',
        signalKey: 'propertyType',
        candidateField: 'propertyType',
        operator: 'enum_in',
      }),
      rule({
        id: 'soft',
        kind: 'soft',
        signalKey: 'configuration',
        candidateField: 'config',
        weight: 90,
        maxContribution: 90,
      }),
    ]);
    // Lead allows only villa; candidate is an apartment → hard fail.
    const l = lead({ preferences: { propertyType: ['villa'], configuration: true } });
    const c = [candidate({ fields: { propertyType: 'apartment', config: true } })];
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: c,
      calculatedAt: AT,
    });
    // pref 'villa' not in candidate enum 'apartment' => hard fail
    expect(r.rankedCandidates[0]!.eligible).toBe(false);
    expect(r.rankedCandidates[0]!.hardFailures.length).toBeGreaterThan(0);
  });
});

describe('inventory safety', () => {
  const m = model([
    rule({
      id: 'a',
      signalKey: 'configuration',
      candidateField: 'config',
      weight: 80,
      maxContribution: 80,
    }),
  ]);
  const l = lead({ preferences: { configuration: true } });
  const unit = (over: Partial<MatchCandidate>) =>
    candidate({ level: 'unit', inventoryUnitId: 'u1', fields: { config: true }, ...over });

  it('a fresh available unit is verified + confirmed', () => {
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: [unit({ unitStatus: 'available', unitVerifiedAt: AT })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.inventoryState).toBe('verified_available');
    expect(r.rankedCandidates[0]!.unitConfirmedAvailable).toBe(true);
  });
  it('a stale available unit is NOT confirmed', () => {
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: [unit({ unitStatus: 'available', unitVerifiedAt: '2026-05-01T00:00:00Z' })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.inventoryState).toBe('available_stale');
    expect(r.rankedCandidates[0]!.unitConfirmedAvailable).toBe(false);
  });
  it('a non-available unit is not_available and not confirmed', () => {
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: l,
      candidates: [unit({ unitStatus: 'sold', unitVerifiedAt: AT })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.inventoryState).toBe('not_available');
    expect(r.rankedCandidates[0]!.unitConfirmedAvailable).toBe(false);
  });
});

describe('budget outcomes', () => {
  const m = model([]);
  it('within / above absolute / unknown', () => {
    expect(
      calculateProjectMatches({
        modelVersion: m,
        leadSnapshot: lead({ preferredBudget: 10_000_000 }),
        candidates: [candidate({ unitPrice: 9_000_000 })],
        calculatedAt: AT,
      }).rankedCandidates[0]!.budgetOutcome,
    ).toBe('within');
    expect(
      calculateProjectMatches({
        modelVersion: m,
        leadSnapshot: lead({ absoluteMaxBudget: 8_000_000 }),
        candidates: [candidate({ unitPrice: 9_000_000 })],
        calculatedAt: AT,
      }).rankedCandidates[0]!.budgetOutcome,
    ).toBe('above_absolute');
    expect(
      calculateProjectMatches({
        modelVersion: m,
        leadSnapshot: lead({}),
        candidates: [candidate({ unitPrice: 9_000_000 })],
        calculatedAt: AT,
      }).rankedCandidates[0]!.budgetOutcome,
    ).toBe('budget_unknown');
    expect(
      calculateProjectMatches({
        modelVersion: m,
        leadSnapshot: lead({ preferredBudget: 10_000_000 }),
        candidates: [candidate({})],
        calculatedAt: AT,
      }).rankedCandidates[0]!.budgetOutcome,
    ).toBe('price_unknown');
  });
});

describe('missing data + confidence', () => {
  it('missing preference does not hard-fail by default and lists missing', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'configuration',
        candidateField: 'config',
        weight: 50,
        maxContribution: 50,
      }),
    ]);
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: lead({ preferences: {} }),
      candidates: [candidate({ fields: { config: true } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.eligible).toBe(true);
    expect(r.rankedCandidates[0]!.missingPreferences).toContain('configuration');
  });
  it('preference completeness is separate from score', () => {
    const m = model(
      [
        rule({
          id: 'a',
          signalKey: 'configuration',
          candidateField: 'config',
          weight: 80,
          maxContribution: 80,
        }),
      ],
      { preferenceSignals: ['budget', 'configuration'] },
    );
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: lead({ preferences: { configuration: true } }),
      candidates: [candidate({ fields: { config: true } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.score).toBeGreaterThan(0);
    expect(r.rankedCandidates[0]!.preferenceCompleteness).toBeCloseTo(0.5, 5);
  });
});

describe('fairness', () => {
  it('rejects a model with a prohibited input', () => {
    expect(() =>
      assertNoProhibitedMatchInputs([
        rule({ id: 'a', signalKey: 'religion', candidateField: 'x' }),
      ]),
    ).toThrow(/prohibited_match_input/);
  });
  it('drops a prohibited lead preference (no effect)', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'religion',
        candidateField: 'religion',
        weight: 90,
        maxContribution: 90,
      }),
    ]);
    const r = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: lead({ preferences: { religion: 'X' } }),
      candidates: [candidate({ fields: { religion: 'X' } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.score).toBe(0);
  });
  it('source/name alone does not exclude (no rule consumes them)', () => {
    const m = model([
      rule({
        id: 'a',
        signalKey: 'configuration',
        candidateField: 'config',
        weight: 60,
        maxContribution: 60,
      }),
    ]);
    const withName = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: lead({ preferences: { configuration: true, name_demographic: 'Z' } }),
      candidates: [candidate({ fields: { config: true } })],
      calculatedAt: AT,
    });
    const without = calculateProjectMatches({
      modelVersion: m,
      leadSnapshot: lead({ preferences: { configuration: true } }),
      candidates: [candidate({ fields: { config: true } })],
      calculatedAt: AT,
    });
    expect(withName.rankedCandidates[0]!.score).toBe(without.rankedCandidates[0]!.score);
  });
});

describe('AI extraction validation (review-only)', () => {
  it('accepts an allowed, well-formed field', () => {
    expect(validateExtractionProposal({ signalKey: 'budget', value: '9000000' }).ok).toBe(true);
    expect(validateExtractionProposal({ signalKey: 'amenities', value: ['gym'] }).ok).toBe(true);
  });
  it('rejects a prohibited field', () => {
    expect(validateExtractionProposal({ signalKey: 'religion', value: 'x' })).toEqual({
      ok: false,
      reason: 'prohibited',
    });
  });
  it('rejects an unknown (non-allowlisted) field', () => {
    expect(validateExtractionProposal({ signalKey: 'salary', value: '100' })).toEqual({
      ok: false,
      reason: 'unknown_field',
    });
  });
  it('rejects a malformed (empty) value', () => {
    expect(validateExtractionProposal({ signalKey: 'budget', value: '' }).reason).toBe('malformed');
    expect(validateExtractionProposal({ signalKey: 'amenities', value: [] }).reason).toBe(
      'malformed',
    );
    expect(validateExtractionProposal({ signalKey: 'budget', value: null }).reason).toBe(
      'malformed',
    );
  });
  it('idempotency key is deterministic and value-sensitive', () => {
    const base = {
      tenantId: 't',
      leadId: 'l',
      signalKey: 'budget',
      promptVersion: 'p1',
      modelConfig: 'm',
      value: '9000000',
    };
    expect(buildExtractionIdempotencyKey(base)).toBe(buildExtractionIdempotencyKey(base));
    expect(buildExtractionIdempotencyKey({ ...base, value: '8000000' })).not.toBe(
      buildExtractionIdempotencyKey(base),
    );
  });
});
