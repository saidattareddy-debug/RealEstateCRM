/**
 * Website-chat session lifecycle logic (Phase 4.1, Priority 1). Pure.
 *
 * The token itself (a high-entropy opaque string) is generated and hashed
 * server-side; only its SHA-256 hash is stored. These helpers decide validity,
 * expiry, sliding renewal, and rotation — they never see internal identifiers.
 */

export type WebsiteSessionStatus = 'active' | 'expired' | 'rotated' | 'ended';

export interface SessionUsability {
  usable: boolean;
  reason: 'ok' | 'not_active' | 'expired';
}

/** A session is usable only when active and not past its expiry. */
export function sessionUsable(
  status: WebsiteSessionStatus,
  expiresAt: string,
  now: Date,
): SessionUsability {
  if (status !== 'active') return { usable: false, reason: 'not_active' };
  if (new Date(expiresAt).getTime() <= now.getTime()) return { usable: false, reason: 'expired' };
  return { usable: true, reason: 'ok' };
}

/** ISO expiry `ttlMinutes` from `now`. */
export function nextExpiry(now: Date, ttlMinutes: number): string {
  return new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
}

/**
 * Whether to slide (renew) the session. We only write a new `last_seen_at` /
 * expiry once the elapsed time since the last update exceeds `slideMinutes`, to
 * avoid a DB write on every poll.
 */
export function shouldSlide(lastSeenAt: string, now: Date, slideMinutes: number): boolean {
  return now.getTime() - new Date(lastSeenAt).getTime() >= slideMinutes * 60_000;
}

/** The next token version after a rotation. */
export function nextTokenVersion(current: number): number {
  return current + 1;
}
