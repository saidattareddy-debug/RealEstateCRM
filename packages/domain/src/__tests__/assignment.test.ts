import { describe, it, expect } from 'vitest';
import { assignLead, isEligible, type Agent } from '../assignment';

const agent = (over: Partial<Agent>): Agent => ({
  id: 'a',
  available: true,
  languages: ['en'],
  activeLeadCount: 0,
  maxActiveLeads: 10,
  projectIds: [],
  roundRobinPosition: 0,
  ...over,
});

describe('isEligible', () => {
  it('rejects unavailable / at-capacity / language / project', () => {
    expect(isEligible(agent({ available: false }), {}).reason).toBe('unavailable');
    expect(isEligible(agent({ activeLeadCount: 10, maxActiveLeads: 10 }), {}).reason).toBe(
      'at_capacity',
    );
    expect(isEligible(agent({ languages: ['hi'] }), { language: 'ta' }).reason).toBe(
      'language_mismatch',
    );
    expect(isEligible(agent({ projectIds: ['p1'] }), { projectId: 'p2' }).reason).toBe(
      'project_not_authorized',
    );
  });
  it('accepts an agent with no language/project constraints', () => {
    expect(
      isEligible(agent({ languages: [], projectIds: [] }), { language: 'ta', projectId: 'p9' }).ok,
    ).toBe(true);
  });
});

describe('assignLead', () => {
  it('preserves a manual assignment unless forced', () => {
    const res = assignLead({ manualAgentId: 'm1' }, [agent({ id: 'a' })]);
    expect(res).toEqual({ agentId: 'm1', reason: 'manual_assignment_preserved' });
    const forced = assignLead({ manualAgentId: 'm1' }, [agent({ id: 'a' })], {
      forceOverrideManual: true,
    });
    expect(forced?.agentId).toBe('a');
  });

  it('returns null when no agent is eligible', () => {
    expect(assignLead({ language: 'ta' }, [agent({ languages: ['en'] })])).toBeNull();
  });

  it('prefers project-authorized then language then least-loaded then round-robin', () => {
    const agents: Agent[] = [
      agent({ id: 'busy', activeLeadCount: 5, projectIds: ['p1'], languages: ['en'] }),
      agent({ id: 'free', activeLeadCount: 0, projectIds: ['p1'], languages: ['en'] }),
      agent({ id: 'other', activeLeadCount: 0, projectIds: ['p2'], languages: ['en'] }),
    ];
    const res = assignLead({ projectId: 'p1', language: 'en' }, agents);
    expect(res?.agentId).toBe('free');
    expect(res?.reason).toContain('project_match');
    expect(res?.reason).toContain('language_match');
  });

  it('uses round-robin position to break ties', () => {
    const agents: Agent[] = [
      agent({ id: 'second', roundRobinPosition: 2 }),
      agent({ id: 'first', roundRobinPosition: 1 }),
    ];
    expect(assignLead({}, agents)?.agentId).toBe('first');
  });

  it('respects workload caps (skips at-capacity agents)', () => {
    const agents: Agent[] = [
      agent({ id: 'full', activeLeadCount: 3, maxActiveLeads: 3 }),
      agent({ id: 'open', activeLeadCount: 2, maxActiveLeads: 3 }),
    ];
    expect(assignLead({}, agents)?.agentId).toBe('open');
  });
});
