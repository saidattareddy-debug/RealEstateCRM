/**
 * Working-hours-aware SLA engine (Phase 4.1, Priority 5). Pure & deterministic.
 *
 * Timezone is modelled as a fixed UTC offset (minutes) so the engine is fully
 * testable without a timezone library; the tenant's IANA offset is resolved
 * upstream. Working hours are per-weekday windows in local minutes-from-midnight;
 * holidays and empty-window days (e.g. weekends) are skipped.
 */

/** [startMinute, endMinute] within a local day, 0..1440. */
export type Window = [number, number];

export interface WorkingHours {
  /** Tenant timezone offset from UTC, in minutes (e.g. IST = +330). */
  offsetMinutes: number;
  /** Windows per weekday, 0 = Sunday … 6 = Saturday. Empty array = closed. */
  week: Record<number, Window[]>;
  /** Local calendar dates with no service, `YYYY-MM-DD`. */
  holidays?: string[];
}

function localParts(utc: Date, offsetMinutes: number) {
  const local = new Date(utc.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const weekday = local.getUTCDay();
  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { y, m, d, weekday, minutesOfDay, dateStr };
}

/** UTC instant for local midnight of (utc's local day) + dayOffset days + localMinute. */
function utcForLocal(
  baseUtc: Date,
  offsetMinutes: number,
  dayOffset: number,
  localMinute: number,
): Date {
  const local = new Date(baseUtc.getTime() + offsetMinutes * 60_000);
  const midnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + dayOffset,
    0,
    0,
    0,
    0,
  );
  return new Date(midnight + localMinute * 60_000 - offsetMinutes * 60_000);
}

function isHoliday(wh: WorkingHours, baseUtc: Date, dayOffset: number): boolean {
  if (!wh.holidays || wh.holidays.length === 0) return false;
  const probe = utcForLocal(baseUtc, wh.offsetMinutes, dayOffset, 0);
  const { dateStr } = localParts(probe, wh.offsetMinutes);
  return wh.holidays.includes(dateStr);
}

/**
 * Add `minutes` of working time to `start`, skipping closed periods, weekends
 * (empty windows) and holidays. Returns the resulting UTC instant. If the
 * working week is entirely empty, returns `start` + `minutes` of wall time.
 */
export function addWorkingMinutes(start: Date, minutes: number, wh: WorkingHours): Date {
  if (minutes <= 0) return start;
  const totalConfigured = Object.values(wh.week).reduce(
    (acc, ws) => acc + ws.reduce((a, [s, e]) => a + Math.max(0, e - s), 0),
    0,
  );
  if (totalConfigured === 0) return new Date(start.getTime() + minutes * 60_000);

  let remaining = minutes;
  // Look ahead up to ~2 years of days to consume the budget.
  for (let dayOffset = 0; dayOffset < 740 && remaining > 0; dayOffset++) {
    const probe = utcForLocal(start, wh.offsetMinutes, dayOffset, 0);
    const { weekday } = localParts(probe, wh.offsetMinutes);
    if (isHoliday(wh, start, dayOffset)) continue;
    const windows = wh.week[weekday] ?? [];
    for (const [winStart, winEnd] of windows) {
      // On day 0 we can only use time at/after the start instant.
      let effStart = winStart;
      if (dayOffset === 0) {
        const { minutesOfDay } = localParts(start, wh.offsetMinutes);
        effStart = Math.max(winStart, minutesOfDay);
      }
      if (effStart >= winEnd) continue;
      const avail = winEnd - effStart;
      if (remaining <= avail) {
        return utcForLocal(start, wh.offsetMinutes, dayOffset, effStart + remaining);
      }
      remaining -= avail;
    }
  }
  // Fallback (should not happen within the horizon).
  return new Date(start.getTime() + minutes * 60_000);
}

/** Whether `instant` falls inside a configured working window. */
export function isWithinWorkingHours(instant: Date, wh: WorkingHours): boolean {
  const { weekday, minutesOfDay, dateStr } = localParts(instant, wh.offsetMinutes);
  if (wh.holidays?.includes(dateStr)) return false;
  const windows = wh.week[weekday] ?? [];
  return windows.some(([s, e]) => minutesOfDay >= s && minutesOfDay < e);
}

// ---------------------------------------------------------------------------
// Policy precedence
// ---------------------------------------------------------------------------

export interface SlaPolicyRow {
  id: string;
  projectId: string | null;
  channel: string | null;
  priority: string | null;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  workingHours: WorkingHours | null;
  active: boolean;
}

export interface SlaSelector {
  projectId: string | null;
  channel: string | null;
  priority: string | null;
}

/**
 * Deterministic policy precedence (most specific wins), evaluated over the
 * tenant's active policies:
 *
 *   1. project + channel + priority   (all three match)
 *   2. project + channel
 *   3. project + priority
 *   4. project
 *   5. channel + priority
 *   6. channel
 *   7. priority
 *   8. tenant default (no project/channel/priority constraints)
 *
 * A policy constraint of `null` is a wildcard. Ties at the same specificity are
 * broken by id (stable). Returns null when nothing matches.
 */
export function resolveSlaPolicy(
  policies: readonly SlaPolicyRow[],
  sel: SlaSelector,
): SlaPolicyRow | null {
  const matches = policies.filter(
    (p) =>
      p.active &&
      (p.projectId == null || p.projectId === sel.projectId) &&
      (p.channel == null || p.channel === sel.channel) &&
      (p.priority == null || p.priority === sel.priority),
  );
  if (matches.length === 0) return null;
  const score = (p: SlaPolicyRow) =>
    (p.projectId != null ? 4 : 0) + (p.channel != null ? 2 : 0) + (p.priority != null ? 1 : 0);
  return [...matches].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}

/** Standard Mon–Fri 9–18 in a given offset, for defaults/tests. */
export function standardWeek(offsetMinutes = 0): WorkingHours {
  const day: Window[] = [[9 * 60, 18 * 60]];
  return {
    offsetMinutes,
    week: { 0: [], 1: day, 2: day, 3: day, 4: day, 5: day, 6: [] },
    holidays: [],
  };
}
