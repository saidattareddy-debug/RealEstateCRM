import { describe, it, expect } from 'vitest';
import { sessionUsable, nextExpiry, shouldSlide, nextTokenVersion } from '../session';

const now = new Date('2026-06-19T12:00:00Z');

describe('sessionUsable', () => {
  it('active + future expiry → usable', () => {
    expect(sessionUsable('active', '2026-06-19T13:00:00Z', now)).toEqual({
      usable: true,
      reason: 'ok',
    });
  });
  it('expired token → not usable', () => {
    expect(sessionUsable('active', '2026-06-19T11:00:00Z', now).reason).toBe('expired');
  });
  it('rotated / ended → not usable (previous-token reuse blocked)', () => {
    expect(sessionUsable('rotated', '2026-06-19T13:00:00Z', now).reason).toBe('not_active');
    expect(sessionUsable('ended', '2026-06-19T13:00:00Z', now).reason).toBe('not_active');
  });
});

describe('nextExpiry / shouldSlide / nextTokenVersion', () => {
  it('computes a future expiry', () => {
    expect(nextExpiry(now, 60)).toBe('2026-06-19T13:00:00.000Z');
  });
  it('slides only after the window elapses', () => {
    expect(shouldSlide('2026-06-19T11:58:00Z', now, 5)).toBe(false);
    expect(shouldSlide('2026-06-19T11:50:00Z', now, 5)).toBe(true);
  });
  it('bumps the token version on rotation', () => {
    expect(nextTokenVersion(1)).toBe(2);
  });
});
