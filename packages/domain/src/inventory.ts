/**
 * Deterministic inventory rules (framework/DB independent).
 * The matching/AI layers MUST use these — only `available` units are offerable,
 * and stale availability must be re-verified before being asserted to a buyer
 * (MASTER_SPEC §10, docs/SCORING_ENGINE.md §7).
 */

export const INVENTORY_STATUSES = [
  'available',
  'temporarily_held',
  'reserved',
  'booked',
  'sold',
  'blocked',
  'unavailable',
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/** Only truly-available units may be offered/matched. */
export function isOfferable(status: InventoryStatus): boolean {
  return status === 'available';
}

/** A unit's availability is stale if it hasn't been verified within the window. */
export function isStale(
  lastVerifiedAt: Date | string,
  freshnessHours: number,
  now: Date = new Date(),
): boolean {
  const verified = typeof lastVerifiedAt === 'string' ? new Date(lastVerifiedAt) : lastVerifiedAt;
  const ageMs = now.getTime() - verified.getTime();
  return ageMs > freshnessHours * 3_600_000;
}

export interface UnitLike {
  status: InventoryStatus;
  lastVerifiedAt: Date | string;
  price?: number | null;
}

export interface AvailabilitySummary {
  total: number;
  available: number;
  offerable: number; // available AND fresh
  stale: number; // available BUT stale (needs re-verification before offering)
  byStatus: Record<InventoryStatus, number>;
}

export function summarizeAvailability(
  units: readonly UnitLike[],
  freshnessHours: number,
  now: Date = new Date(),
): AvailabilitySummary {
  const byStatus = Object.fromEntries(INVENTORY_STATUSES.map((s) => [s, 0])) as Record<
    InventoryStatus,
    number
  >;
  let available = 0;
  let offerable = 0;
  let stale = 0;
  for (const u of units) {
    byStatus[u.status] += 1;
    if (u.status === 'available') {
      available += 1;
      if (isStale(u.lastVerifiedAt, freshnessHours, now)) stale += 1;
      else offerable += 1;
    }
  }
  return { total: units.length, available, offerable, stale, byStatus };
}
