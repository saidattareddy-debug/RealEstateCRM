# Scoring Rules (Phase 6A)

This document defines the deterministic rule model used by `calculateLeadScore` (`packages/domain/src/scoring.ts`): the operators, the rule fields, the rule groups, group caps and minimums, total bounds, deterministic ordering, conflict resolution, stop-processing, effective/expiry windows, and the missing-value / disqualify / review handling.

It complements [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md) and [`SCORING_SIGNALS.md`](./SCORING_SIGNALS.md).

---

## 1. Rule operators

A rule tests one signal observation with one operator. The eleven operators are:

- **`boolean_true`** — the signal is a known boolean and is true.
- **`numeric_range`** — a known numeric value falls within a `[min, max]` range.
- **`enum_in`** — a known enum/string value is in an allowed set.
- **`exact_match`** — a known value equals an exact target.
- **`set_intersection`** — a known set value intersects a target set (for example, a wanted amenity matches an available amenity).
- **`count_gte`** — a known count is greater than or equal to a threshold.
- **`date_recency`** — an observation's time is recent relative to a window (uses `observedAt`).
- **`completion`** — a required signal is present/known (drives evidence completeness).
- **`missing_value`** — the signal is unknown/absent (lets a rule react to absence explicitly rather than implicitly).
- **`disqualify`** — when matched, hard-disqualifies the lead.
- **`review_required`** — when matched, forces the lead into review.

## 2. Rule fields

Each rule carries the fields needed for deterministic, explainable evaluation:

- **id** — stable identifier (a tiebreak for ordering and the key stamped into components).
- **group** — the rule group (see §3).
- **operator** — one of the eleven operators above.
- **signal key** — the signal the rule reads (must not be a prohibited signal; see [`SCORING_FAIRNESS.md`](./SCORING_FAIRNESS.md)).
- **points / weight** — the contribution applied when the rule matches.
- **priority** — the primary ordering key (lower runs first).
- **operator parameters** — range bounds, allowed set, target, threshold, or recency window as the operator requires.
- **unknown handling** — `zero` | `review` | `skip` (see §8).
- **effective window** — optional `effective_from` / `effective_to` bounds (see §7).
- **stop-processing flag** — optional short-circuit (see §6).

## 3. Rule groups

Rules belong to one of eight groups, which both organise the explanation and carry caps/minimums:

- **intent** — buyer intent signals (site-visit request, booking question, callback request).
- **fit** — project/buyer fit (budget, configuration, location, purpose, amenities).
- **engagement** — responsiveness and interaction depth.
- **source** — lead source quality (only via tenant-approved rules; never alone proves quality).
- **freshness** — recency of evidence and activity.
- **qualification** — required-field completion signals.
- **negative** — penalties and detractors.
- **disqualification** — hard-stop rules.

## 4. Group caps and minimums; total bounds; scale clamp

- **Group caps** — a per-group maximum (`groupCaps`) is applied after the group's matching rules are summed, so no single group can dominate beyond its configured ceiling.
- **Group minimums** — a per-group floor (`groupMinimums`) where a group must not fall below a configured value.
- **Total bounds** — the summed total is bounded after group caps/minimums are applied.
- **Scale clamp** — the final score is clamped to the documented **0–100** scale. The scale is fixed in documentation; classification thresholds within the scale are tenant-configurable.

## 5. Deterministic ordering

Rules evaluate in a stable, reproducible order: **priority first, then id** as a tiebreak. Because the order is deterministic and the active model version is immutable, the component list, the applied/skipped sets, and the explanation are identical for identical inputs. This is what makes a stamped historical score reproducible.

## 6. Conflicting-rule resolution and stop-processing

- **Caps resolve over-contribution.** When several rules in the same group match, their contributions sum and are then bounded by the group cap, so "too many positive matches" cannot exceed the group ceiling.
- **Disqualification short-circuits positive scoring.** A matched `disqualify` rule classifies the lead as `disqualified`; positive contributions do not rescue a disqualified lead.
- **Review is sticky.** A matched `review_required` rule (or a contradictory critical fact) forces `review_required`; it is not silently overridden by a high numeric score.
- **Stop-processing.** A rule may carry a stop-processing flag that short-circuits further evaluation once it matches (used for hard rules), keeping the outcome unambiguous and order-stable.

## 7. Effective and expiry windows

A rule may carry an effective window (`effective_from` / `effective_to`). A rule outside its window at `calculatedAt` is not applied. This lets a tenant schedule a rule change without editing an active version (you draft and activate a new version for structural changes; the window handles time-bounded applicability within a version's design).

## 8. Missing-value, disqualify and review handling

- **Default unknown handling is `zero`.** An unknown signal contributes **zero** points and reduces evidence completeness; it never disqualifies a lead by itself. Missing data is treated as missing information, not as a negative signal.
- **`review` unknown handling** routes the lead to `review_required` when the signal is unknown (used for signals where absence genuinely needs a human).
- **`skip` unknown handling** simply skips the rule (recorded in the skipped set with a reason).
- **`disqualify`** is reserved for explicit hard rules; it short-circuits positive scoring and classifies the lead `disqualified`.
- **`review_required`** forces human review. A **contradictory** critical fact also forces review even if the numeric score is high.

Evidence completeness and calculation confidence are tracked **separately** from the numeric score, so a lead can have a high score and still be flagged as incompletely qualified — a high score never implies complete qualification.
