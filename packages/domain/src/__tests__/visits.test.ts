import { describe, it, expect } from 'vitest';
import {
  canTransitionVisit,
  transitionVisit,
  isTerminalVisitState,
  detectDoubleBooking,
  resolveVisitOutcomeState,
  VISIT_STATES,
  type BusyBlock,
} from '../visits';

describe('visit lifecycle state machine', () => {
  it('allows valid transitions', () => {
    expect(canTransitionVisit('requested', 'scheduled')).toBe(true);
    expect(canTransitionVisit('scheduled', 'confirmed')).toBe(true);
    expect(canTransitionVisit('confirmed', 'in_progress')).toBe(true);
    expect(canTransitionVisit('in_progress', 'completed')).toBe(true);
    expect(canTransitionVisit('scheduled', 'no_show')).toBe(true);
    expect(canTransitionVisit('no_show', 'rescheduled')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransitionVisit('requested', 'completed')).toBe(false);
    expect(canTransitionVisit('completed', 'scheduled')).toBe(false);
    expect(canTransitionVisit('cancelled', 'scheduled')).toBe(false);
  });

  it('transitionVisit reports reasons', () => {
    expect(transitionVisit('scheduled', 'scheduled').reason).toBe('no_op');
    expect(transitionVisit('requested', 'completed').reason).toBe('illegal_transition');
    expect(transitionVisit('requested', 'scheduled')).toEqual({
      ok: true,
      from: 'requested',
      to: 'scheduled',
      reason: null,
    });
  });

  it('terminal states are terminal', () => {
    expect(isTerminalVisitState('completed')).toBe(true);
    expect(isTerminalVisitState('cancelled')).toBe(true);
    expect(isTerminalVisitState('scheduled')).toBe(false);
    // every state is known
    expect(VISIT_STATES).toContain('rescheduled');
  });
});

describe('detectDoubleBooking', () => {
  const busy: BusyBlock[] = [
    { start: '2026-06-22T10:00:00Z', end: '2026-06-22T11:00:00Z', source: 'visit', refId: 'v1' },
    { start: '2026-06-22T14:00:00Z', end: '2026-06-22T15:00:00Z', source: 'calendar', refId: 'c1' },
  ];

  it('detects an overlapping window', () => {
    const r = detectDoubleBooking(
      { start: '2026-06-22T10:30:00Z', end: '2026-06-22T11:30:00Z' },
      busy,
    );
    expect(r.conflict).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.refId).toBe('v1');
  });

  it('allows a non-overlapping window', () => {
    const r = detectDoubleBooking(
      { start: '2026-06-22T11:00:00Z', end: '2026-06-22T12:00:00Z' },
      busy,
    );
    expect(r.conflict).toBe(false); // touching edge is not overlap
  });

  it('rejects an invalid window (end <= start)', () => {
    const r = detectDoubleBooking(
      { start: '2026-06-22T12:00:00Z', end: '2026-06-22T12:00:00Z' },
      busy,
    );
    expect(r.conflict).toBe(true);
  });
});

describe('resolveVisitOutcomeState', () => {
  it('attended → completed; absent → no_show', () => {
    expect(resolveVisitOutcomeState({ attended: true })).toBe('completed');
    expect(resolveVisitOutcomeState({ attended: false })).toBe('no_show');
  });
});
