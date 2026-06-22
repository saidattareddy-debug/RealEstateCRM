# Matching Rules (Phase 6B)

This document defines the deterministic rule model used by `calculateProjectMatches` (`packages/domain/src/matching.ts`): the operators, the rule fields, the rule kinds, the rule groups, group caps and minimums, hard-failure reasons, deterministic ordering and the stable tie-break, total normalization, and the missing-data handling per kind.

Matching rules are advisory: they shape an opinion about fit, never an action. A matched rule never assigns a lead, changes a stage/status/score, reserves inventory, or sends anything. It complements [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md), [`MATCHING_INVENTORY_SAFETY.md`](./MATCHING_INVENTORY_SAFETY.md), and [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md).

---

## 1. Rule operators

A rule tests one aspect of a candidate against the lead snapshot with one operator. The fourteen operators are:

- **`boolean_true`** — a known boolean candidate/lead field is true.
- **`enum_in`** — a known enum/string value is in an allowed set (for example, property type).
- **`numeric_range`** — a known numeric value falls within a `[min, max]` range.
- **`budget_overlap`** — the lead's budget band overlaps the candidate's price band.
- **`area_overlap`** — the lead's wanted area/size band overlaps the candidate's available area band.
- **`date_window_overlap`** — the lead's possession/timeline window overlaps the candidate's availability window.
- **`distance_threshold`** — a trusted stored distance fact is within a threshold (travel time is never fabricated; absent → Unknown — see [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md)).
- **`set_intersection`** — a wanted set intersects an available set (for example, wanted amenities vs. project amenities).
- **`required_feature`** — a required feature must be present (its absence is a hard failure).
- **`preferred_feature`** — a preferred feature contributes when present but is not required.
- **`missing_value`** — the relevant lead/candidate value is unknown/absent (lets a rule react to absence explicitly).
- **`exclusion`** — a lead-expressed exclusion matches the candidate (excludes it).
- **`review_required`** — when matched, forces the candidate into review.
- **`freshness`** — the candidate's inventory/availability evidence is within the freshness window.

## 2. Rule fields

Each rule carries the fields needed for deterministic, explainable evaluation:

- **id** — stable identifier (a tiebreak for ordering and the key stamped into components).
- **kind** — `hard` | `soft` | `informational` | `review_required` (see §3).
- **group** — the rule group (see §4).
- **operator** — one of the fourteen operators above.
- **signal key / candidate field** — the lead signal and candidate field the rule reads (neither may be a prohibited signal; see [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md), and the DB CHECK in [`DATABASE.md`](./DATABASE.md) §"Phase 6B").
- **weight / points** — the contribution applied when the rule matches (for soft/informational kinds).
- **operator parameters** — range bounds, allowed set, target set, threshold, or window as the operator requires.
- **missing handling** — how an unknown value is treated for this rule (see §9).
- **priority** — the ordering key for evaluation.

## 3. Rule kinds

A rule's **kind** determines how a match affects eligibility and the score:

- **`hard`** — a hard requirement. A failed hard rule makes the candidate ineligible (a hard-failure reason; see §6). Hard rules express must-haves (for example, sale applicability, required configuration, an explicit exclusion).
- **`soft`** — a weighted preference. A matched soft rule contributes its weight to the candidate's score within its group cap; a missed soft rule simply does not contribute.
- **`informational`** — surfaces a fact in the explanation without driving eligibility or (materially) the score; used to annotate a candidate.
- **`review_required`** — forces the candidate into the `review_required` classification (a human must look) rather than silently ranking it.

## 4. Rule groups

Rules belong to one of twelve groups, which both organise the explanation and carry caps/minimums:

- **budget** — budget/price fit.
- **configuration** — configuration/type fit.
- **location** — locality/location fit (structured locality data only; never neighbourhood demographic profiling).
- **property_type** — property category/type fit.
- **area** — area/size fit.
- **possession** — possession/timeline fit.
- **amenities** — amenity fit.
- **lifestyle** — lifestyle preference fit.
- **financing** — financing-related fit.
- **inventory** — inventory availability fit.
- **freshness** — recency of inventory/availability evidence.
- **exclusions** — lead-expressed exclusions (hard).

## 5. Group caps and minimums; total normalization

- **Group caps** — a per-group maximum is applied after the group's matching soft/informational rules are summed, so no single group can dominate beyond its configured ceiling.
- **Group minimums** — a per-group floor where a group must not fall below a configured value.
- **Total normalization** — after group caps and minimums are applied, the summed total is normalized to the documented match scale, so scores are comparable across candidates and reproducible. Match **confidence** and **preference completeness** are tracked **separately** from this numeric score (see [`MATCHING_EXPLAINABILITY.md`](./MATCHING_EXPLAINABILITY.md)); a high match score never implies complete preference information.

## 6. Hard-failure reasons and eligibility gates

Before ranking, every candidate passes through **eligibility gates**. A candidate that fails any gate is classified `ineligible`, scored 0, and ranked after every eligible candidate. The eligibility gates are:

- **`cross_tenant`** — the candidate is not in the lead's tenant.
- **`project_inactive`** — the project is not active.
- **`project_unapproved`** — the project is not approved.
- **`not_visible`** — the project is not visible.
- **`not_sale_applicable`** — the project/candidate is not sale-applicable.
- **`property_category`** — the candidate's property category does not match a required category.
- **`excluded_by_lead`** — a lead-expressed exclusion matches the candidate.

A failed **`hard`** rule produces a hard-failure reason in the same way and renders the candidate ineligible. Hard failures are explicit and explainable — the candidate's components record which gate or hard rule excluded it (see [`MATCHING_EXPLAINABILITY.md`](./MATCHING_EXPLAINABILITY.md)).

## 7. Classifications

Each eligible candidate is classified by its normalized score and rule outcomes; ineligible and review candidates are classified directly:

- **`excellent`**, **`good`**, **`possible`**, **`weak`** — graded eligible fit.
- **`ineligible`** — failed an eligibility gate or a hard rule (score 0).
- **`review_required`** — a `review_required` rule fired (a human must look).
- **`insufficient_information`** — too little preference information to classify the fit with confidence.

## 8. Deterministic ordering and stable tie-break

Rules evaluate in a stable, reproducible order: **priority first, then id** as a tiebreak. Candidates are ranked **eligible first, then by score descending, with a stable tie-break by `candidateId`**; ineligible candidates (score 0) follow. Because the order is deterministic and the active model version is immutable, the candidate list, the per-rule components, and the classifications are identical for identical inputs. This is what makes a stamped historical match run reproducible.

## 9. Missing-data handling per kind

Missing data is treated as missing information, never as a hidden penalty or a proxy for a protected trait (see [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md)):

- **`hard`** — a missing value required by a hard rule does not silently exclude; where a required fact is unknown the candidate is routed to `review_required` or marked `insufficient_information` rather than being treated as a confirmed failure, unless the gate itself is definitive (for example, a project that is not sale-applicable).
- **`soft`** — a missing value simply means the rule does not contribute; the candidate is not penalised, and preference completeness is reduced.
- **`informational`** — a missing value is recorded as Unknown in the explanation and affects neither eligibility nor the score.
- **`review_required`** — where a `review_required` rule depends on a value that is unknown, the candidate is surfaced for human review rather than guessed.

A candidate with too little preference information is classified `insufficient_information` rather than being scored confidently. Preference completeness and match confidence are tracked separately from the numeric score, so an incompletely-specified lead is never presented as a confident match.
