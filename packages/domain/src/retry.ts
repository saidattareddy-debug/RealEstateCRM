/**
 * Deterministic retry/backoff policy for durable jobs and ingestion
 * (MASTER_SPEC §29). Pure, DB-independent so it can be unit-tested and shared by
 * the sync/outbox/PGMQ drivers.
 */

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  /** Exponential factor per attempt. */
  factor: number;
  /** Upper bound on a single delay. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 30_000, // 30s
  factor: 3,
  maxDelayMs: 6 * 3_600_000, // 6h cap
};

/** Delay (ms) before the Nth attempt (attempt is 1-based: 1 = first retry). */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  if (attempt < 1) return 0;
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/** True once attempts have reached the maximum (next failure → dead-letter). */
export function isExhausted(attempts: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return attempts >= policy.maxAttempts;
}

export type FailureDecision =
  | { action: 'retry'; nextRetryAt: Date; delayMs: number }
  | { action: 'dead_letter' };

/**
 * Decide what to do after a failed attempt. `attempts` is the count *after*
 * incrementing for the failure just observed.
 */
export function decideAfterFailure(
  attempts: number,
  now: Date = new Date(),
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): FailureDecision {
  if (isExhausted(attempts, policy)) return { action: 'dead_letter' };
  const delayMs = backoffDelayMs(attempts, policy);
  return { action: 'retry', nextRetryAt: new Date(now.getTime() + delayMs), delayMs };
}
