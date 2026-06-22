import { describe, it, expect } from 'vitest';
import {
  addWorkingMinutes,
  isWithinWorkingHours,
  standardWeek,
  resolveSlaPolicy,
  type SlaPolicyRow,
} from '../sla';

// UTC working week (offset 0), Mon–Fri 09:00–18:00.
const wh = standardWeek(0);

describe('addWorkingMinutes', () => {
  it('adds within the same working day', () => {
    // Wed 2026-06-17 10:00Z + 120 min → 12:00Z
    const due = addWorkingMinutes(new Date('2026-06-17T10:00:00Z'), 120, wh);
    expect(due.toISOString()).toBe('2026-06-17T12:00:00.000Z');
  });

  it('rolls overnight to the next working day', () => {
    // Wed 17:00Z + 120 min: 1h left Wed (→18:00), 1h spills to Thu 09:00→10:00
    const due = addWorkingMinutes(new Date('2026-06-17T17:00:00Z'), 120, wh);
    expect(due.toISOString()).toBe('2026-06-18T10:00:00.000Z');
  });

  it('skips the weekend', () => {
    // Fri 2026-06-19 17:30Z + 60 min: 30m Fri (→18:00), 30m on Mon 09:00→09:30
    const due = addWorkingMinutes(new Date('2026-06-19T17:30:00Z'), 60, wh);
    expect(due.toISOString()).toBe('2026-06-22T09:30:00.000Z');
  });

  it('skips a configured holiday', () => {
    const whHol = { ...wh, holidays: ['2026-06-18'] };
    // Wed 17:30Z + 60: 30m Wed, Thu is holiday → 30m Fri 09:00→09:30
    const due = addWorkingMinutes(new Date('2026-06-17T17:30:00Z'), 60, whHol);
    expect(due.toISOString()).toBe('2026-06-19T09:30:00.000Z');
  });

  it('respects a tenant offset (IST +330)', () => {
    const ist = standardWeek(330);
    // 2026-06-17T03:30Z = 09:00 IST (Wed) → +60 working min = 04:30Z (10:00 IST)
    const due = addWorkingMinutes(new Date('2026-06-17T03:30:00Z'), 60, ist);
    expect(due.toISOString()).toBe('2026-06-17T04:30:00.000Z');
  });

  it('a fully-closed week falls back to wall-clock minutes', () => {
    const closed = { offsetMinutes: 0, week: {}, holidays: [] };
    const due = addWorkingMinutes(new Date('2026-06-17T10:00:00Z'), 30, closed);
    expect(due.toISOString()).toBe('2026-06-17T10:30:00.000Z');
  });
});

describe('resolveSlaPolicy (precedence: most specific wins)', () => {
  const row = (
    id: string,
    projectId: string | null,
    channel: string | null,
    priority: string | null,
  ): SlaPolicyRow => ({
    id,
    projectId,
    channel,
    priority,
    firstResponseMinutes: 15,
    nextResponseMinutes: 60,
    workingHours: null,
    active: true,
  });
  const policies = [
    row('tenant', null, null, null),
    row('chan', null, 'whatsapp', null),
    row('proj', 'p1', null, null),
    row('projchan', 'p1', 'whatsapp', null),
    row('projchanprio', 'p1', 'whatsapp', 'urgent'),
  ];
  it('picks the all-three match', () => {
    expect(
      resolveSlaPolicy(policies, { projectId: 'p1', channel: 'whatsapp', priority: 'urgent' })?.id,
    ).toBe('projchanprio');
  });
  it('falls back to project+channel, then channel, then tenant', () => {
    expect(
      resolveSlaPolicy(policies, { projectId: 'p1', channel: 'whatsapp', priority: 'low' })?.id,
    ).toBe('projchan');
    expect(
      resolveSlaPolicy(policies, { projectId: 'p2', channel: 'whatsapp', priority: 'low' })?.id,
    ).toBe('chan');
    expect(
      resolveSlaPolicy(policies, { projectId: 'p2', channel: 'email', priority: 'low' })?.id,
    ).toBe('tenant');
  });
  it('returns null when nothing matches and no tenant default', () => {
    expect(
      resolveSlaPolicy([row('chan', null, 'whatsapp', null)], {
        projectId: null,
        channel: 'email',
        priority: null,
      }),
    ).toBeNull();
  });
  it('ignores inactive policies', () => {
    const inactive = [{ ...row('x', null, null, null), active: false }];
    expect(
      resolveSlaPolicy(inactive, { projectId: null, channel: null, priority: null }),
    ).toBeNull();
  });
});

describe('isWithinWorkingHours', () => {
  it('true inside the window, false outside / weekend / holiday', () => {
    expect(isWithinWorkingHours(new Date('2026-06-17T10:00:00Z'), wh)).toBe(true);
    expect(isWithinWorkingHours(new Date('2026-06-17T20:00:00Z'), wh)).toBe(false);
    expect(isWithinWorkingHours(new Date('2026-06-20T10:00:00Z'), wh)).toBe(false); // Sat
    expect(
      isWithinWorkingHours(new Date('2026-06-17T10:00:00Z'), { ...wh, holidays: ['2026-06-17'] }),
    ).toBe(false);
  });
});
