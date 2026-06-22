import { describe, it, expect } from 'vitest';
import { backoffDelayMs, isExhausted, decideAfterFailure, DEFAULT_RETRY_POLICY } from '../retry';

describe('retry policy', () => {
  it('grows exponentially and caps at maxDelay', () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(90_000);
    expect(backoffDelayMs(3)).toBe(270_000);
    expect(backoffDelayMs(99)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
    expect(backoffDelayMs(0)).toBe(0);
  });

  it('is exhausted at maxAttempts', () => {
    expect(isExhausted(4)).toBe(false);
    expect(isExhausted(5)).toBe(true);
    expect(isExhausted(6)).toBe(true);
  });

  it('schedules a retry before exhaustion and dead-letters after', () => {
    const now = new Date('2026-06-19T00:00:00Z');
    const d2 = decideAfterFailure(2, now);
    expect(d2.action).toBe('retry');
    if (d2.action === 'retry') {
      expect(d2.delayMs).toBe(90_000);
      expect(d2.nextRetryAt.getTime()).toBe(now.getTime() + 90_000);
    }
    expect(decideAfterFailure(5, now).action).toBe('dead_letter');
  });
});
