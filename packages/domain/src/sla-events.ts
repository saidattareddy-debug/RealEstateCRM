/**
 * Deterministic SLA-event derivation (Phase 4.1). Pure: given the previous and
 * the freshly-recomputed SLA snapshot for a conversation, produce the exact list
 * of `conversation_sla_events` rows to emit. The server persists them with the
 * resolved policy id, the (new) due time, the previous due time, the reason and
 * a correlation id — this module decides *which* events fire, never fabricating
 * aggregate performance.
 */

import type { SlaStatus } from './inbox';

export type SlaEventKind =
  | 'started'
  | 'first_response_due'
  | 'due_recalculated'
  | 'due_soon'
  | 'first_response_met'
  | 'breach'
  | 'breach_resolved'
  | 'paused'
  | 'resumed'
  | 'closed'
  | 'reopened';

export interface SlaSnapshot {
  /** Computed first-response due time (working-hours adjusted), or null. */
  dueAt: string | null;
  /** Deterministic status from computeSlaStatus. */
  status: SlaStatus;
  /** Whether a first response has been recorded. */
  firstResponded: boolean;
  /** Whether the conversation is in a closed/archived lifecycle. */
  closed: boolean;
}

export interface DerivedSlaEvent {
  kind: SlaEventKind;
  dueAt: string | null;
  previousDueAt: string | null;
}

/**
 * Diff two snapshots into the SLA events that should be recorded. `prev` is null
 * the first time SLA is computed for a conversation.
 */
export function deriveSlaEvents(prev: SlaSnapshot | null, next: SlaSnapshot): DerivedSlaEvent[] {
  const events: DerivedSlaEvent[] = [];
  const due = (kind: SlaEventKind, previousDueAt: string | null = null) =>
    events.push({ kind, dueAt: next.dueAt, previousDueAt });

  // First computation for this conversation.
  if (prev === null) {
    if (next.closed) return events; // nothing to start on an already-closed conv
    due('started');
    if (next.dueAt && !next.firstResponded) due('first_response_due');
    if (next.status === 'due_soon') due('due_soon');
    if (next.status === 'breached') due('breach');
    return events;
  }

  // Lifecycle transitions.
  if (next.closed && !prev.closed) {
    due('closed');
    return events; // a close supersedes due/breach churn
  }
  if (!next.closed && prev.closed) {
    due('reopened');
    if (next.dueAt && !next.firstResponded) due('first_response_due');
  }

  // Due-time recalculation (e.g. priority/channel/project change moved the SLA).
  if (next.dueAt && prev.dueAt && next.dueAt !== prev.dueAt) {
    due('due_recalculated', prev.dueAt);
  }

  // First response just landed.
  if (next.firstResponded && !prev.firstResponded) {
    due('first_response_met');
  }

  // Pause / resume.
  if (next.status === 'paused' && prev.status !== 'paused') due('paused');
  if (prev.status === 'paused' && next.status !== 'paused') due('resumed');

  // Due-soon crossing (only when not already responded/closed).
  if (next.status === 'due_soon' && prev.status !== 'due_soon' && prev.status !== 'breached') {
    due('due_soon');
  }

  // Breach + breach resolution (resolved by a first response or re-computation).
  if (next.status === 'breached' && prev.status !== 'breached') due('breach');
  if (prev.status === 'breached' && next.status !== 'breached') due('breach_resolved');

  return events;
}

/** UI chip label for a status (shared by list/header/context/mobile). */
export function slaChipLabel(status: SlaStatus, applicable: boolean): string {
  if (!applicable) return 'Not Applicable';
  switch (status) {
    case 'breached':
      return 'Breached';
    case 'due_soon':
      return 'Due Soon';
    case 'paused':
      return 'Paused';
    default:
      return 'On Track';
  }
}
