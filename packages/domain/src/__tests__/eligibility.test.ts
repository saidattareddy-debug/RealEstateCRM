import { describe, it, expect } from 'vitest';
import { evaluateEligibility, eligibilityReasonLabel, type AgentSignals } from '../eligibility';

const NOW = new Date('2026-06-19T12:00:00Z');

const agent = (over: Partial<AgentSignals> = {}): AgentSignals => ({
  agentId: 'a1',
  membershipStatus: 'active',
  availability: 'available',
  absentFrom: null,
  absentUntil: null,
  teamIds: ['t1'],
  authorizedProjectIds: [],
  languages: [],
  activeConversationCount: 0,
  maxActiveConversations: 0,
  ...over,
});

describe('evaluateEligibility', () => {
  it('accepts a fully-eligible agent', () => {
    const r = evaluateEligibility(agent(), { now: NOW });
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('excludes a suspended membership', () => {
    const r = evaluateEligibility(agent({ membershipStatus: 'suspended' }), { now: NOW });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('inactive_membership');
  });

  it('excludes an away or absent agent', () => {
    expect(evaluateEligibility(agent({ availability: 'away' }), { now: NOW }).reasons).toContain(
      'unavailable',
    );
    const absent = evaluateEligibility(
      agent({ absentFrom: '2026-06-19T08:00:00Z', absentUntil: '2026-06-19T18:00:00Z' }),
      { now: NOW },
    );
    expect(absent.reasons).toContain('absent');
  });

  it('respects required team membership', () => {
    expect(
      evaluateEligibility(agent({ teamIds: ['t2'] }), { requiredTeamId: 't1', now: NOW }).reasons,
    ).toContain('not_in_team');
    expect(
      evaluateEligibility(agent({ teamIds: ['t1'] }), { requiredTeamId: 't1', now: NOW }).eligible,
    ).toBe(true);
  });

  it('respects project authorization (empty = all projects)', () => {
    expect(
      evaluateEligibility(agent({ authorizedProjectIds: ['p2'] }), { projectId: 'p1', now: NOW })
        .reasons,
    ).toContain('not_project_authorized');
    expect(
      evaluateEligibility(agent({ authorizedProjectIds: [] }), { projectId: 'p1', now: NOW })
        .eligible,
    ).toBe(true);
  });

  it('respects language compatibility (empty = any)', () => {
    expect(
      evaluateEligibility(agent({ languages: ['en'] }), { language: 'hi', now: NOW }).reasons,
    ).toContain('language_mismatch');
    expect(
      evaluateEligibility(agent({ languages: [] }), { language: 'hi', now: NOW }).eligible,
    ).toBe(true);
  });

  it('respects the workload cap (0 = uncapped)', () => {
    expect(
      evaluateEligibility(agent({ activeConversationCount: 5, maxActiveConversations: 5 }), {
        now: NOW,
      }).reasons,
    ).toContain('at_workload_cap');
    expect(
      evaluateEligibility(agent({ activeConversationCount: 50, maxActiveConversations: 0 }), {
        now: NOW,
      }).eligible,
    ).toBe(true);
  });

  it('flags a locked conversation', () => {
    expect(evaluateEligibility(agent(), { ownershipLocked: true, now: NOW }).reasons).toContain(
      'ownership_locked',
    );
  });

  it('accumulates multiple reasons', () => {
    const r = evaluateEligibility(
      agent({ membershipStatus: 'invited', availability: 'away', languages: ['en'] }),
      { language: 'fr', now: NOW },
    );
    expect(r.reasons.sort()).toEqual(['inactive_membership', 'language_mismatch', 'unavailable']);
  });

  it('exposes human-readable reason labels', () => {
    expect(eligibilityReasonLabel('at_workload_cap')).toBe('At active-conversation cap');
  });
});
