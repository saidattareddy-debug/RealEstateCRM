# Matching Explainability (Phase 6B)

Every recommendation and every exclusion has an explanation. A user must be able to answer, for any lead: **Why was this project recommended? Why was that one excluded? Which preference mattered? Is the inventory verified? What changed since the last run? Was the ranking overridden?** This document defines how the deterministic engine and the schema make those answers available, and the guarantee that there are no unexplained matches.

Explainability serves the advisory boundary: the explanation describes an opinion a human reviews. Nothing in a match explanation assigns a lead, changes a stage/status/score, reserves inventory, or sends anything. It complements [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md), [`MATCHING_RULES.md`](./MATCHING_RULES.md), and [`MATCHING_INVENTORY_SAFETY.md`](./MATCHING_INVENTORY_SAFETY.md).

---

## 1. Every recommendation and exclusion is explained

`calculateProjectMatches` returns, for each candidate, a self-explaining record. Alongside the numeric `score` and `classification`, each candidate carries:

- **components** — the per-rule contributions (group, kind, operator, candidate field, contribution, applied/skipped, reason, explanation text), persisted to `lead_match_components`.
- **eligibility outcome** — whether the candidate passed the gates, and if not, exactly which gate or hard rule excluded it (`cross_tenant`, `project_inactive`, `project_unapproved`, `not_visible`, `not_sale_applicable`, `property_category`, `excluded_by_lead`, or a failed hard rule).
- **inventory state** — one of the six states, with `unitConfirmedAvailable` true only for `verified_available` (see [`MATCHING_INVENTORY_SAFETY.md`](./MATCHING_INVENTORY_SAFETY.md)).
- **budget outcome** — the approved-data budget outcome (within / near / above_preferred / above_absolute / unknown / requires_verification).
- **match confidence** and **preference completeness** — tracked separately from the numeric score.
- **explanation** — a human-readable, ordered narrative of why the candidate ranked where it did.

## 2. Answering the explainability questions

- **Why was this project recommended?** — the classification plus the `components` of the contributing groups (budget, configuration, location, property type, possession, amenities, …) and the explanation narrative show which soft rules drove the candidate up the ranking.
- **Why was that one excluded?** — the eligibility outcome names the exact gate or hard rule that made the candidate `ineligible` (score 0, ranked last); the component for that gate/rule records the reason.
- **Which preference mattered?** — the per-rule components name the lead signal and candidate field each rule read and the contribution it made, so the deciding preferences are explicit; `insufficient_information` is shown when too little preference data was available.
- **Is the inventory verified?** — the candidate's inventory state answers directly: only `verified_available` yields a confirmed unit; stale/unknown/unavailable states are surfaced with a re-verification request, never as confirmed.
- **What changed since the last run?** — successive `lead_match_runs` are append-only and version-stamped, each with its trigger, preference/qualification snapshots, and `inventory_snapshot_at`, so a reader can compare runs and see which candidates entered, left, or moved, and whether the cause was a preference change, an inventory change, or a model-version change.
- **Was the ranking overridden?** — the effective rank overlays any `lead_match_overrides` row (with its reason, actor, and the before/after rank) on the calculated ranking, which remains visible underneath.

## 3. Match history fields

Match history is reconstructable from the append-only, version-stamped run records. Each run records:

- the model version in force (`model_version_id NOT NULL`);
- the lead preference and qualification snapshots used;
- the `inventory_snapshot_at` (and per-candidate `lead_match_inventory_snapshots`);
- the trigger that caused the run;
- the per-candidate classifications, scores, inventory states, and budget outcomes;
- the per-rule components;
- the timestamp.

Because runs are never overwritten, the full sequence of "what matched, why, under which version, and against which inventory snapshot" is always reconstructable.

## 4. Calculated rank vs effective (override) rank

- The **calculated rank** is the machine opinion from `calculateProjectMatches`, persisted in `lead_match_candidates` against a version-stamped `lead_match_runs` row.
- The **effective rank** is what a human acts on: an override overlays a manual adjustment on top of the calculated ranking. The calculated values are always preserved beneath the override, and an override never changes the lead, the candidate facts, or inventory.

Both are shown so a reviewer can see the machine's ranking and the human's adjustment side by side, never one silently replacing the other. Feedback recorded via `lead_match_feedback` is likewise advisory and does not alter the calculated run.

## 5. No unexplained matches

Every match run records its trigger and model version; every candidate carries its eligibility outcome, inventory state, budget outcome, and per-rule components; every exclusion names the gate or hard rule that caused it; and every override records a reason, an actor, and the before/after rank. There is therefore **no path** by which a candidate is recommended or excluded without a recorded, attributable, human-readable reason. Combined with determinism (identical inputs reproduce identical results) and version stamping (the rules that produced a historical run are immutable), this guarantees the match history is fully explainable after the fact.
