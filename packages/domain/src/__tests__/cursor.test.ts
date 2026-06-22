import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  compareForCursor,
  isAfterCursor,
  mergeNewMessages,
} from '../cursor';

describe('cursor encode/decode', () => {
  it('round-trips and is opaque (no raw fields visible)', () => {
    const pos = { createdAt: '2026-06-19T10:00:00.000Z', id: 'm1' };
    const c = encodeCursor(pos);
    expect(c).not.toContain('m1');
    expect(c).not.toContain('2026');
    expect(decodeCursor(c)).toEqual(pos);
  });
  it('rejects malformed / forged cursors', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('not-base64-$$')).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":1}', 'utf8').toString('base64url'))).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"t":"nope","i":"x"}', 'utf8').toString('base64url')),
    ).toBeNull();
  });
});

describe('ordering', () => {
  it('is stable under equal timestamps (id tiebreak)', () => {
    const a = { createdAt: '2026-06-19T10:00:00Z', id: 'a' };
    const b = { createdAt: '2026-06-19T10:00:00Z', id: 'b' };
    expect(compareForCursor(a, b)).toBeLessThan(0);
    expect(compareForCursor(b, a)).toBeGreaterThan(0);
  });
  it('isAfterCursor handles the null (initial) case and strict ordering', () => {
    const pos = { createdAt: '2026-06-19T10:00:00Z', id: 'b' };
    expect(isAfterCursor(pos, null)).toBe(true);
    expect(isAfterCursor(pos, pos)).toBe(false);
    expect(isAfterCursor(pos, { createdAt: '2026-06-19T10:00:00Z', id: 'a' })).toBe(true);
  });
});

describe('mergeNewMessages (dedup + order)', () => {
  it('drops already-seen ids and orders the rest', () => {
    const seen = new Set(['a']);
    const incoming = [
      { createdAt: '2026-06-19T10:02:00Z', id: 'c' },
      { createdAt: '2026-06-19T10:00:00Z', id: 'a' },
      { createdAt: '2026-06-19T10:01:00Z', id: 'b' },
    ];
    expect(mergeNewMessages(seen, incoming).map((m) => m.id)).toEqual(['b', 'c']);
  });
});
