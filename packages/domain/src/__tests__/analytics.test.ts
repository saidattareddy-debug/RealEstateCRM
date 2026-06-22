import { describe, it, expect } from 'vitest';
import {
  computeFunnel,
  computeSourcePerformance,
  computeTeamPerformance,
  computeUsage,
  anyOverLimit,
  rollupHealth,
} from '../analytics';

describe('computeFunnel', () => {
  it('computes top + prev conversion and drop-off, sorted by order', () => {
    const m = computeFunnel([
      { stageId: 'c', name: 'Won', order: 2, reached: 20 },
      { stageId: 'a', name: 'New', order: 0, reached: 100 },
      { stageId: 'b', name: 'Qualified', order: 1, reached: 50 },
    ]);
    expect(m.map((s) => s.stageId)).toEqual(['a', 'b', 'c']);
    expect(m[1]!.conversionFromTop).toBe(50);
    expect(m[1]!.conversionFromPrev).toBe(50);
    expect(m[2]!.conversionFromTop).toBe(20);
    expect(m[2]!.conversionFromPrev).toBe(40);
    expect(m[2]!.droppedFromPrev).toBe(30);
  });

  it('handles an empty funnel and a zero top', () => {
    expect(computeFunnel([])).toEqual([]);
    const m = computeFunnel([{ stageId: 'a', name: 'New', order: 0, reached: 0 }]);
    expect(m[0]!.conversionFromTop).toBe(0);
  });
});

describe('computeSourcePerformance', () => {
  it('win rate + CPL/CPA, null spend → null costs', () => {
    const [s] = computeSourcePerformance([
      { sourceId: 's1', name: 'Portal', leads: 40, won: 8, lost: 12, spend: 20000 },
    ]);
    expect(s!.winRate).toBe(20);
    expect(s!.costPerLead).toBe(500);
    expect(s!.costPerWon).toBe(2500);
    const [s2] = computeSourcePerformance([
      { sourceId: 's2', name: 'Referral', leads: 10, won: 0, lost: 1 },
    ]);
    expect(s2!.costPerLead).toBeNull();
    expect(s2!.costPerWon).toBeNull();
  });
});

describe('computeTeamPerformance', () => {
  it('win rate, avg first response, open leads', () => {
    const [a] = computeTeamPerformance([
      {
        agentId: 'a1',
        name: 'Asha',
        assigned: 20,
        won: 5,
        lost: 5,
        responseMinutesTotal: 300,
        responseSamples: 10,
      },
    ]);
    expect(a!.winRate).toBe(25);
    expect(a!.avgFirstResponseMins).toBe(30);
    expect(a!.openLeads).toBe(10);
    const [b] = computeTeamPerformance([
      {
        agentId: 'a2',
        name: 'Ben',
        assigned: 0,
        won: 0,
        lost: 0,
        responseMinutesTotal: 0,
        responseSamples: 0,
      },
    ]);
    expect(b!.avgFirstResponseMins).toBeNull();
    expect(b!.winRate).toBe(0);
  });
});

describe('computeUsage', () => {
  it('utilization, over/near limit, remaining', () => {
    const m = computeUsage([
      { metric: 'tokens', used: 90, limit: 100 },
      { metric: 'messages', used: 120, limit: 100 },
      { metric: 'projects', used: 3, limit: null },
    ]);
    expect(m[0]!.utilization).toBe(90);
    expect(m[0]!.nearLimit).toBe(true);
    expect(m[0]!.overLimit).toBe(false);
    expect(m[0]!.remaining).toBe(10);
    expect(m[1]!.overLimit).toBe(true);
    expect(m[2]!.utilization).toBe(0); // unlimited
    expect(m[2]!.remaining).toBeNull();
    expect(anyOverLimit(m)).toBe(true);
  });

  it('Infinity limit is treated as unlimited', () => {
    const [u] = computeUsage([{ metric: 'x', used: 5, limit: Number.POSITIVE_INFINITY }]);
    expect(u!.overLimit).toBe(false);
    expect(u!.remaining).toBeNull();
  });
});

describe('rollupHealth', () => {
  it('returns the worst component state', () => {
    expect(rollupHealth([])).toBe('unknown');
    expect(
      rollupHealth([
        { component: 'db', state: 'healthy' },
        { component: 'queue', state: 'degraded' },
      ]),
    ).toBe('degraded');
    expect(
      rollupHealth([
        { component: 'db', state: 'healthy' },
        { component: 'provider', state: 'down' },
        { component: 'queue', state: 'degraded' },
      ]),
    ).toBe('down');
    expect(rollupHealth([{ component: 'db', state: 'healthy' }])).toBe('healthy');
  });
});
