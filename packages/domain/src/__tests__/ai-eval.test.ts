import { describe, it, expect } from 'vitest';
import { scoreEvalCase, summarizeEval, type EvalExpectation, type EvalActual } from '../ai-eval';

const expectation = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({
  expectedGrounding: 'grounded',
  expectedEscalation: null,
  requiredCitationCategories: ['Approved project FAQ'],
  forbiddenClaims: ['guaranteed return', 'definitely available'],
  expectedToolCalls: [],
  draftAllowed: true,
  language: 'en',
  ...over,
});

const actual = (over: Partial<EvalActual> = {}): EvalActual => ({
  grounding: 'grounded',
  escalation: null,
  citationCategories: ['Approved project FAQ'],
  draftText: 'The project has a clubhouse and pool, per the approved FAQ.',
  toolCalls: [],
  outputLanguage: 'en',
  crossTenantLeak: false,
  crossProjectLeak: false,
  draftProduced: true,
  ...over,
});

describe('scoreEvalCase', () => {
  it('passes a correct, grounded, well-cited answer', () => {
    const r = scoreEvalCase(expectation(), actual());
    expect(r.passed).toBe(true);
  });

  it('fails on grounding mismatch', () => {
    const r = scoreEvalCase(expectation(), actual({ grounding: 'insufficient_evidence' }));
    expect(r.groundingMatch).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('fails an unsupported (forbidden) claim', () => {
    const r = scoreEvalCase(
      expectation(),
      actual({ draftText: 'This unit is definitely available and a guaranteed return.' }),
    );
    expect(r.unsupportedClaim).toBe(true);
    expect(r.passed).toBe(false);
  });

  it('requires citation coverage only when a draft was produced', () => {
    // Draft produced but missing the required category → invalid.
    expect(scoreEvalCase(expectation(), actual({ citationCategories: [] })).citationValid).toBe(
      false,
    );
    // No draft (escalation case) → citation coverage not required.
    const esc = scoreEvalCase(
      expectation({
        expectedGrounding: 'insufficient_evidence',
        expectedEscalation: 'insufficient_approved_knowledge',
        draftAllowed: false,
      }),
      actual({
        grounding: 'insufficient_evidence',
        escalation: 'insufficient_approved_knowledge',
        draftProduced: false,
        citationCategories: [],
      }),
    );
    expect(esc.citationValid).toBe(true);
    expect(esc.passed).toBe(true);
  });

  it('hard-fails on any tenant/project isolation leak', () => {
    expect(scoreEvalCase(expectation(), actual({ crossTenantLeak: true })).isolationOk).toBe(false);
    expect(scoreEvalCase(expectation(), actual({ crossTenantLeak: true })).passed).toBe(false);
    expect(scoreEvalCase(expectation(), actual({ crossProjectLeak: true })).passed).toBe(false);
  });

  it('checks expected tool calls are present', () => {
    expect(
      scoreEvalCase(
        expectation({ expectedToolCalls: ['getAvailableUnits'] }),
        actual({ toolCalls: [] }),
      ).toolMatch,
    ).toBe(false);
    expect(
      scoreEvalCase(
        expectation({ expectedToolCalls: ['getAvailableUnits'] }),
        actual({ toolCalls: ['getAvailableUnits', 'getProjectOverview'] }),
      ).toolMatch,
    ).toBe(true);
  });

  it('accepts an allowed English fallback for language preservation', () => {
    expect(
      scoreEvalCase(expectation({ language: 'ta' }), actual({ outputLanguage: 'en' }))
        .languagePreserved,
    ).toBe(true);
    expect(
      scoreEvalCase(expectation({ language: 'ta' }), actual({ outputLanguage: 'hi' }))
        .languagePreserved,
    ).toBe(false);
  });

  it('enforces draft discipline (no draft when not allowed)', () => {
    const r = scoreEvalCase(
      expectation({ draftAllowed: false, expectedGrounding: 'unsupported_question' }),
      actual({ draftProduced: true, grounding: 'unsupported_question' }),
    );
    expect(r.draftDisciplineOk).toBe(false);
    expect(r.passed).toBe(false);
  });
});

describe('summarizeEval', () => {
  it('aggregates accuracy + unsupported-claim + isolation metrics', () => {
    const results = [
      scoreEvalCase(expectation(), actual()),
      scoreEvalCase(expectation(), actual({ draftText: 'guaranteed return' })),
      scoreEvalCase(expectation(), actual({ crossTenantLeak: true })),
    ];
    const s = summarizeEval(results);
    expect(s.total).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.isolationFailures).toBe(1);
    expect(s.unsupportedClaimRate).toBeCloseTo(1 / 3, 5);
  });
});
