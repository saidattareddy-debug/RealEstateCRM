import 'server-only';

/**
 * Best-effort in-memory fixed-window rate limiter. Per-instance only — a
 * distributed limiter (Upstash/Redis or Postgres) replaces this for production
 * multi-instance deploys (noted in docs/SECURITY.md). Good enough to enforce
 * per-form/per-IP limits in a single instance and in tests.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limitPerMinute: number, now: number = Date.now()): boolean {
  const windowMs = 60_000;
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limitPerMinute) return false;
  b.count += 1;
  return true;
}
