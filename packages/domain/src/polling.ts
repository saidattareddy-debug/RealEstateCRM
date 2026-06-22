/**
 * Pure polling-loop reconciliation + backoff (Phase 4.1, Priority 2).
 *
 * The client transport is a thin shell around these deterministic functions:
 * given the prior loop state and the outcome of one fetch, compute the new
 * messages to surface, the next cursor, the connection state, and how long to
 * wait before the next poll. Keeping this framework-free makes the hard parts
 * (dedup, equal-timestamp ordering, backoff, hidden-tab slowdown, stop-on-close)
 * exhaustively unit-testable without a DOM or a network.
 */

import { type CursorPosition, mergeNewMessages } from './cursor';

export type PollConnectionState = 'open' | 'reconnecting';

export interface PollLoopState {
  cursor?: string;
  failures: number;
}

export type FetchOutcome<T extends CursorPosition> =
  | { ok: true; messages: readonly T[]; nextCursor: string | null }
  | { ok: false };

export interface ReconcileResult<T extends CursorPosition> {
  /** New, deduped, stably-ordered messages to append. */
  fresh: T[];
  /** The loop state to carry into the next tick. */
  next: PollLoopState;
  /** Honest connection state after this fetch. */
  state: PollConnectionState;
}

/**
 * Reconcile one fetch against the already-seen ids. On success: dedup + order
 * the page, advance the cursor, reset the failure counter. On failure: keep the
 * cursor (safe resume) and increment failures so the caller can back off.
 *
 * `seen` is mutated to include the freshly-surfaced ids (the loop owns one Set).
 */
export function reconcileFetch<T extends CursorPosition>(
  prev: PollLoopState,
  seen: Set<string>,
  outcome: FetchOutcome<T>,
): ReconcileResult<T> {
  if (!outcome.ok) {
    return {
      fresh: [],
      next: { cursor: prev.cursor, failures: prev.failures + 1 },
      state: 'reconnecting',
    };
  }
  const fresh = mergeNewMessages(seen, outcome.messages);
  for (const m of fresh) seen.add(m.id);
  return {
    fresh,
    next: {
      cursor: outcome.nextCursor ?? prev.cursor,
      failures: 0,
    },
    state: 'open',
  };
}

export interface BackoffInput {
  base: number;
  hiddenMultiplier: number;
  maxBackoff: number;
  state: PollConnectionState;
  failures: number;
  hidden: boolean;
  /** Closed/archived conversations reconcile once then stop. */
  pollOnce: boolean;
}

/**
 * Delay (ms) until the next poll, or `null` to stop entirely. Exponential
 * backoff while reconnecting; slower cadence while the tab is hidden; a single
 * reconciling fetch for closed conversations.
 */
export function nextPollDelay(input: BackoffInput): number | null {
  if (input.pollOnce && input.state === 'open') return null;
  if (input.state === 'reconnecting') {
    return Math.min(input.maxBackoff, input.base * 2 ** input.failures);
  }
  if (input.hidden) return input.base * input.hiddenMultiplier;
  return input.base;
}
