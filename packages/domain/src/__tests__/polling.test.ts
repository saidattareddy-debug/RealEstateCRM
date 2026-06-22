import { describe, it, expect } from 'vitest';
import { reconcileFetch, nextPollDelay, type PollLoopState } from '../polling';
import { encodeCursor } from '../cursor';

interface Msg {
  id: string;
  createdAt: string;
}
const m = (id: string, createdAt: string): Msg => ({ id, createdAt });

describe('reconcileFetch', () => {
  it('surfaces the initial page and advances the cursor (hydration)', () => {
    const seen = new Set<string>();
    const prev: PollLoopState = { failures: 0 };
    const page = [m('a', '2026-06-19T10:00:00Z'), m('b', '2026-06-19T10:01:00Z')];
    const r = reconcileFetch(prev, seen, {
      ok: true,
      messages: page,
      nextCursor: encodeCursor({ createdAt: page[1]!.createdAt, id: page[1]!.id }),
    });
    expect(r.fresh.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.state).toBe('open');
    expect(r.next.failures).toBe(0);
    expect(r.next.cursor).toBeTruthy();
    expect([...seen]).toEqual(['a', 'b']);
  });

  it('appends only incremental messages on the next poll', () => {
    const seen = new Set(['a', 'b']);
    const r = reconcileFetch({ failures: 0, cursor: 'c' }, seen, {
      ok: true,
      messages: [m('c', '2026-06-19T10:02:00Z')],
      nextCursor: 'c2',
    });
    expect(r.fresh.map((x) => x.id)).toEqual(['c']);
    expect(r.next.cursor).toBe('c2');
  });

  it('orders equal-timestamp messages deterministically by id', () => {
    const seen = new Set<string>();
    const r = reconcileFetch({ failures: 0 }, seen, {
      ok: true,
      messages: [m('y', '2026-06-19T10:00:00Z'), m('x', '2026-06-19T10:00:00Z')],
      nextCursor: 'n',
    });
    expect(r.fresh.map((x) => x.id)).toEqual(['x', 'y']);
  });

  it('deduplicates a duplicated server response', () => {
    const seen = new Set<string>();
    const first = reconcileFetch({ failures: 0 }, seen, {
      ok: true,
      messages: [m('a', '2026-06-19T10:00:00Z')],
      nextCursor: 'n',
    });
    expect(first.fresh).toHaveLength(1);
    const dup = reconcileFetch(first.next, seen, {
      ok: true,
      messages: [m('a', '2026-06-19T10:00:00Z')],
      nextCursor: 'n',
    });
    expect(dup.fresh).toHaveLength(0); // already seen
    expect(dup.state).toBe('open');
  });

  it('replays the same cursor safely (no new rows, cursor preserved)', () => {
    const seen = new Set(['a']);
    const r = reconcileFetch({ failures: 0, cursor: 'keep' }, seen, {
      ok: true,
      messages: [],
      nextCursor: null,
    });
    expect(r.fresh).toHaveLength(0);
    expect(r.next.cursor).toBe('keep'); // null nextCursor keeps prior cursor
  });

  it('marks reconnecting and bumps failures on network failure (cursor kept)', () => {
    const r = reconcileFetch({ failures: 2, cursor: 'keep' }, new Set(), { ok: false });
    expect(r.state).toBe('reconnecting');
    expect(r.next.failures).toBe(3);
    expect(r.next.cursor).toBe('keep'); // safe resume
    expect(r.fresh).toHaveLength(0);
  });

  it('resets failures after a successful reconnect', () => {
    const seen = new Set<string>();
    const r = reconcileFetch({ failures: 5, cursor: 'keep' }, seen, {
      ok: true,
      messages: [m('z', '2026-06-19T11:00:00Z')],
      nextCursor: 'n',
    });
    expect(r.next.failures).toBe(0);
    expect(r.fresh.map((x) => x.id)).toEqual(['z']);
  });
});

describe('nextPollDelay', () => {
  const base = 4000;
  const common = { base, hiddenMultiplier: 4, maxBackoff: 60000 };

  it('uses the base interval when open and visible', () => {
    expect(
      nextPollDelay({ ...common, state: 'open', failures: 0, hidden: false, pollOnce: false }),
    ).toBe(4000);
  });

  it('slows down when the tab is hidden', () => {
    expect(
      nextPollDelay({ ...common, state: 'open', failures: 0, hidden: true, pollOnce: false }),
    ).toBe(16000);
  });

  it('backs off exponentially while reconnecting', () => {
    expect(
      nextPollDelay({
        ...common,
        state: 'reconnecting',
        failures: 1,
        hidden: false,
        pollOnce: false,
      }),
    ).toBe(8000);
    expect(
      nextPollDelay({
        ...common,
        state: 'reconnecting',
        failures: 3,
        hidden: false,
        pollOnce: false,
      }),
    ).toBe(32000);
  });

  it('caps backoff at maxBackoff', () => {
    expect(
      nextPollDelay({
        ...common,
        state: 'reconnecting',
        failures: 20,
        hidden: false,
        pollOnce: false,
      }),
    ).toBe(60000);
  });

  it('stops after one reconcile for a closed conversation', () => {
    expect(
      nextPollDelay({ ...common, state: 'open', failures: 0, hidden: false, pollOnce: true }),
    ).toBeNull();
  });

  it('still retries a failed single-poll for a closed conversation', () => {
    expect(
      nextPollDelay({
        ...common,
        state: 'reconnecting',
        failures: 1,
        hidden: false,
        pollOnce: true,
      }),
    ).toBe(8000);
  });
});
