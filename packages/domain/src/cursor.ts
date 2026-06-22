/**
 * Opaque, server-validated message cursors for the polling transport
 * (Phase 4.1, Priority 2). Pure & deterministic.
 *
 * A cursor encodes the (created_at, id) of the last message a client has seen.
 * It is base64url-encoded so it is opaque to the browser, carries no internal
 * tenant/conversation identifiers, and is stable under equal timestamps via the
 * secondary `id` ordering. The server re-validates every cursor by running the
 * paged query under RLS — a forged cursor can never widen visibility.
 */

export interface CursorPosition {
  createdAt: string; // ISO
  id: string; // message id (tiebreaker)
}

export function encodeCursor(pos: CursorPosition): string {
  const json = JSON.stringify({ t: pos.createdAt, i: pos.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): CursorPosition | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null;
    if (Number.isNaN(new Date(parsed.t).getTime())) return null;
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Total order over messages: by created_at, then by id. Stable when timestamps
 * are equal so pagination never skips or repeats a row.
 */
export function compareForCursor(a: CursorPosition, b: CursorPosition): number {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True iff `pos` is strictly after the cursor (for "fetch since"). */
export function isAfterCursor(pos: CursorPosition, cursor: CursorPosition | null): boolean {
  if (!cursor) return true;
  return compareForCursor(pos, cursor) > 0;
}

/**
 * Deduplicate + order a freshly-fetched page against already-seen ids, returning
 * only the new rows in stable order (client-side reconnect safety).
 */
export function mergeNewMessages<T extends CursorPosition>(
  seenIds: ReadonlySet<string>,
  incoming: readonly T[],
): T[] {
  return [...incoming].filter((m) => !seenIds.has(m.id)).sort(compareForCursor);
}
