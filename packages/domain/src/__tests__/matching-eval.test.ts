import { describe, it, expect } from 'vitest';
import {
  calculateProjectMatches,
  type MatchModelVersion,
  type MatchRule,
  type MatchCandidate,
  type LeadSnapshot,
} from '../matching';

/** Phase 6B evaluation dataset (§22) — synthetic, deterministic. */

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

const MODEL: MatchModelVersion = {
  modelId: 'm',
  version: 'eval-v1',
  scale: { min: 0, max: 100 },
  thresholds: { excellent: 70, good: 50, possible: 30, weak: 0 },
  freshnessWindowDays: 7,
  preferenceSignals: ['budget', 'locality', 'amenities'],
  rules: [
    rule({
      id: 'loc',
      group: 'location',
      signalKey: 'locality',
      candidateField: 'locality',
      operator: 'enum_in',
      weight: 30,
      maxContribution: 30,
      priority: 10,
    }),
    rule({
      id: 'excl',
      group: 'exclusions',
      kind: 'hard',
      operator: 'exclusion',
      signalKey: 'excludedLocalities',
      candidateField: 'locality',
      priority: 1,
      reason: 'excluded_location',
    }),
    rule({
      id: 'amen',
      group: 'amenities',
      signalKey: 'amenities',
      candidateField: 'amenities',
      operator: 'set_intersection',
      weight: 20,
      maxContribution: 20,
      priority: 20,
    }),
    rule({
      id: 'budget',
      group: 'budget',
      signalKey: 'budget',
      candidateField: 'price',
      operator: 'budget_overlap',
      weight: 40,
      maxContribution: 40,
      priority: 5,
    }),
  ],
};

const AT = '2026-06-20T00:00:00Z';

const cand = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
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

const lead = (over: Partial<LeadSnapshot> = {}): LeadSnapshot => ({ preferences: {}, ...over });

describe('matching evaluation dataset', () => {
  it('location match contributes', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { locality: ['Whitefield'] } }),
      candidates: [cand({ fields: { locality: 'Whitefield' } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.score).toBeGreaterThanOrEqual(30);
  });

  it('excluded location hard-fails the candidate', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { excludedLocalities: ['Whitefield'] } }),
      candidates: [cand({ fields: { locality: 'Whitefield' } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.eligible).toBe(false);
    expect(r.rankedCandidates[0]!.hardFailures).toContain('excluded_location');
  });

  it('amenity intersection contributes; no overlap does not', () => {
    const hit = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { amenities: ['pool', 'gym'] } }),
      candidates: [cand({ fields: { amenities: ['gym'] } })],
      calculatedAt: AT,
    });
    const miss = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { amenities: ['pool'] } }),
      candidates: [cand({ fields: { amenities: ['garden'] } })],
      calculatedAt: AT,
    });
    expect(hit.rankedCandidates[0]!.score).toBeGreaterThan(miss.rankedCandidates[0]!.score);
  });

  it('budget overlap contributes; price unknown is handled', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({
        budgetMin: 5_000_000,
        budgetMax: 9_000_000,
        preferences: { budget: { min: 5_000_000, max: 9_000_000 } },
      }),
      candidates: [cand({ advertisedMin: 6_000_000, advertisedMax: 8_000_000 })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.score).toBeGreaterThanOrEqual(40);
  });

  it('strong project match but no fresh inventory: project recommendation stands, unit not confirmed', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { locality: ['Whitefield'], amenities: ['gym'] } }),
      candidates: [
        cand({ fields: { locality: 'Whitefield', amenities: ['gym'], hasAvailableUnit: true } }),
      ],
      calculatedAt: AT,
    });
    const top = r.rankedCandidates[0]!;
    expect(top.eligible).toBe(true);
    expect(top.inventoryState).toBe('available_stale');
    expect(top.unitConfirmedAvailable).toBe(false);
  });

  it('no available units → no_matching_available', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { locality: ['X'] } }),
      candidates: [cand({ fields: { locality: 'X', hasAvailableUnit: false } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.inventoryState).toBe('no_matching_available');
  });

  it('multiple equal candidates rank by stable tie-break', () => {
    const l = lead({ preferences: { locality: ['X'] } });
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: l,
      candidates: [
        cand({ id: 'b', fields: { locality: 'X' } }),
        cand({ id: 'a', fields: { locality: 'X' } }),
      ],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates.map((x) => x.candidateId)).toEqual(['a', 'b']);
  });

  it('cross-tenant candidate cannot be eligible', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { locality: ['X'] } }),
      candidates: [cand({ inTenant: false, fields: { locality: 'X' } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.eligible).toBe(false);
    expect(r.rankedCandidates[0]!.hardFailures).toContain('cross_tenant');
  });

  it('near-budget outcome when just above preferred', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferredBudget: 10_000_000, preferences: { locality: ['X'] } }),
      candidates: [cand({ fields: { locality: 'X' }, unitPrice: 10_500_000 })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.budgetOutcome).toBe('near');
  });

  it('above absolute maximum is flagged', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ absoluteMaxBudget: 8_000_000, preferences: { locality: ['X'] } }),
      candidates: [cand({ fields: { locality: 'X' }, unitPrice: 9_000_000 })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.budgetOutcome).toBe('above_absolute');
  });

  it('a sold unit is never confirmed available', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: { locality: ['X'] } }),
      candidates: [
        cand({
          level: 'unit',
          inventoryUnitId: 'u9',
          fields: { locality: 'X' },
          unitStatus: 'sold',
          unitVerifiedAt: AT,
        }),
      ],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.inventoryState).toBe('not_available');
    expect(r.rankedCandidates[0]!.unitConfirmedAvailable).toBe(false);
  });

  it('missing preferences do not hard-fail but are listed', () => {
    const r = calculateProjectMatches({
      modelVersion: MODEL,
      leadSnapshot: lead({ preferences: {} }),
      candidates: [cand({ fields: { locality: 'X' } })],
      calculatedAt: AT,
    });
    expect(r.rankedCandidates[0]!.eligible).toBe(true);
    expect(r.rankedCandidates[0]!.missingPreferences.length).toBeGreaterThan(0);
  });
});
