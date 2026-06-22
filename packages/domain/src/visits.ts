/**
 * Phase 8 — Site-visit lifecycle + calendar double-booking (PURE, no IO).
 *
 * A deterministic state machine for the site-visit lifecycle and an overlap
 * detector that prevents double-booking an agent. No IO: the server supplies the
 * agent's existing busy blocks (from prior visits + a simulated calendar — live
 * Google Calendar sync is a Phase-7B/credential stop-condition).
 */

export const VISIT_STATES = [
  'requested',
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export type VisitState = (typeof VISIT_STATES)[number];

const TRANSITIONS: Record<VisitState, VisitState[]> = {
  requested: ['scheduled', 'cancelled'],
  scheduled: ['confirmed', 'rescheduled', 'cancelled', 'no_show'],
  confirmed: ['in_progress', 'rescheduled', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: ['rescheduled'],
  rescheduled: ['scheduled', 'cancelled'],
};

export function canTransitionVisit(from: VisitState, to: VisitState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface VisitTransitionResult {
  ok: boolean;
  from: VisitState;
  to: VisitState;
  reason: string | null;
}

export function transitionVisit(from: VisitState, to: VisitState): VisitTransitionResult {
  if (from === to) return { ok: false, from, to, reason: 'no_op' };
  if (!canTransitionVisit(from, to)) return { ok: false, from, to, reason: 'illegal_transition' };
  return { ok: true, from, to, reason: null };
}

/** Terminal states cannot be changed further. */
export function isTerminalVisitState(s: VisitState): boolean {
  return s === 'completed' || s === 'cancelled';
}

export interface TimeWindow {
  start: string; // ISO
  end: string; // ISO
}

export interface BusyBlock extends TimeWindow {
  /** Source of the block: another visit or a (simulated) calendar event. */
  source: 'visit' | 'calendar';
  refId: string;
}

function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  const as = new Date(a.start).getTime();
  const ae = new Date(a.end).getTime();
  const bs = new Date(b.start).getTime();
  const be = new Date(b.end).getTime();
  // Touching edges (ae === bs) is NOT an overlap.
  return as < be && bs < ae;
}

export interface DoubleBookingResult {
  conflict: boolean;
  conflicts: BusyBlock[];
}

/**
 * Detect whether a proposed visit window conflicts with any existing busy block
 * for the same agent. Used to PREVENT double-booking before scheduling.
 */
export function detectDoubleBooking(proposed: TimeWindow, busy: BusyBlock[]): DoubleBookingResult {
  if (new Date(proposed.end).getTime() <= new Date(proposed.start).getTime())
    return { conflict: true, conflicts: [] }; // invalid window
  const conflicts = busy.filter((b) => overlaps(proposed, b));
  return { conflict: conflicts.length > 0, conflicts };
}

export interface VisitOutcome {
  attended: boolean;
  feedback?: string | null;
  interestLevel?: 'high' | 'medium' | 'low' | null;
}

/** Resolve the terminal state implied by an outcome at check-out time. */
export function resolveVisitOutcomeState(outcome: VisitOutcome): VisitState {
  return outcome.attended ? 'completed' : 'no_show';
}
