# Matching Inventory Safety (Phase 6B)

Matching must never present a unit as available when it is not, and must never invent prices, discounts, taxes, or charges. This document defines the six inventory states, the exact conditions under which a unit may be recommended as **confirmed available**, the rule that a stale or absent unit may leave a project-level recommendation standing while never presenting a confirmed unit, and the budget outcomes (no invented charges).

Inventory safety is part of the advisory boundary: matching reads inventory facts and never alters them. Matching never reserves, holds, or books inventory, never assigns a lead, and never changes a stage/status/score or sends anything. It complements [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md) §3 (the three match levels) and [`MATCHING_RULES.md`](./MATCHING_RULES.md).

---

## 1. The six inventory states

Every candidate carries an inventory state computed from approved structured inventory facts only:

- **`verified_available`** — the unit's status is available, the availability evidence is within the freshness window, and there is no reservation conflict. Only this state supports a **confirmed** unit recommendation.
- **`available_stale`** — the unit's status is available but the availability evidence is older than the freshness window. The unit is **not** confirmable; re-verification is requested.
- **`no_matching_available`** — no unit in the candidate matches the lead's configuration/criteria; nothing is presentable as a confirmed unit.
- **`availability_unknown`** — availability cannot be determined from trusted facts; treated as unknown, never as available.
- **`not_available`** — the unit's status is not available (held, booked, sold, or otherwise unavailable). It is never recommended as a unit.
- **`requires_reverification`** — the availability evidence requires re-verification before any unit can be presented as confirmed.

`unitConfirmedAvailable` is true **only** when the state is `verified_available`. No other state yields a confirmed unit.

## 2. Conditions for a confirmed unit recommendation

A unit may be presented as **confirmed available** only when **all** of the following hold:

1. **In-tenant** — the unit belongs to the lead's tenant (cross-tenant candidates are ineligible).
2. **Active + approved project** — the unit's project is active and approved.
3. **Configuration match** — the unit's configuration matches the lead's wanted configuration.
4. **Status available** — the unit's inventory status is available.
5. **Within the freshness window** — the availability evidence is within `freshnessWindowDays`.
6. **No reservation conflict** — there is no reservation or hold that conflicts with offering the unit.
7. **User-permitted** — the viewing user holds the permission to see inventory/unit-level recommendations for this lead/project.

If any condition fails, the unit is not presented as confirmed. There is no path by which a stale, unknown, unavailable, or unpermitted unit is shown as confirmed.

## 3. Stale inventory: project-level recommendation may stand; unit must not be confirmed

When the inventory evidence is **stale** (`available_stale`) or otherwise not `verified_available`:

- a **project-level** (or configuration-level) recommendation **may remain**, because the lead can still suit the project overall; but
- a **unit must not be presented as confirmed** — it is surfaced as stale/unknown with an explicit **re-verification request**, never as a bookable, confirmed unit.

This is why the three match levels are kept distinct (see [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md) §3): the value of a project-level match does not depend on a confirmed unit, and a confirmed unit is never implied by a project-level match. Stale inventory is never shown as confirmed (see also [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md)).

The inventory facts a run rested on are captured in `lead_match_inventory_snapshots` with the run's `inventory_snapshot_at`, so a later reader can see exactly what was available at calculation time even after live inventory changes.

## 4. Budget outcomes (no invented charges)

Every candidate carries a budget outcome derived from **approved structured data only** — matching never invents discounts, taxes, charges, or any price not present as an approved fact:

- **`within`** — the candidate's price fits the lead's budget band.
- **`near`** — the price is near the budget band (within a configured tolerance).
- **`above_preferred`** — the price is above the lead's preferred budget but within an absolute ceiling.
- **`above_absolute`** — the price is above the lead's absolute budget.
- **`budget_unknown`** — the lead's budget is unknown (treated as unknown, never as a fit or a failure).
- **`price_unknown`** — the candidate's price is unknown (treated as unknown).
- **`requires_verification`** — the price requires verification before a budget outcome can be asserted.

Where budget or price is unknown, the outcome is reported as unknown and the candidate's preference completeness is reduced; matching never fabricates a number to force a fit. No discount, tax, registration charge, or other adjustment is ever invented to make a candidate appear within budget — only approved structured price facts are used.
