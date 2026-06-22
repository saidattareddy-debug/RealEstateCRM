# Matching Fairness (Phase 6B)

Deterministic matching must never use protected traits, and must never let name, language, source, or a neighbourhood's demographic profile act as a hidden proxy for them. This document defines the prohibited inputs, the two enforcement layers, the non-inference rules, and the tests and assertions that prove these properties.

Fairness reinforces the advisory boundary: matching proposes a reviewable opinion and never assigns a lead, changes a stage/status/score, reserves inventory, or sends anything. It complements [`MATCHING_RULES.md`](./MATCHING_RULES.md), [`SCORING_FAIRNESS.md`](./SCORING_FAIRNESS.md), and [`SECURITY.md`](./SECURITY.md).

---

## 1. Prohibited inputs

Matching reuses the scoring prohibited-signal catalogue (`PROHIBITED_SIGNAL_KEYS` in `packages/domain/src/scoring.ts`) — the same protected traits that may never participate in scoring may never participate in matching:

- race
- ethnicity
- religion
- caste
- political_affiliation
- sexual_orientation
- disability
- medical_status
- gender
- family_status
- socioeconomic_profile
- accent
- name_demographic
- neighbourhood_demographic

No matching rule may read a prohibited signal (on the lead-signal side or the candidate-field side), and no prohibited input may reach the calculation.

## 2. Two enforcement layers

Fairness is enforced in depth — in the pure domain layer and again in the database — so neither a code path nor a direct database write can slip a prohibited input in.

### 2.1 Domain layer (`packages/domain/src/matching.ts`)

- **`assertNoProhibitedMatchInputs`** rejects prohibited inputs — used so a matching model carrying a prohibited rule, or a calculation given a prohibited lead/candidate input, is refused.
- **Drop-on-calculate.** `calculateProjectMatches` drops any prohibited input even if one is injected, so a prohibited signal can never influence a match regardless of how it reached the function.

### 2.2 Database layer (`supabase/migrations/0022_project_matching.sql`)

- A CHECK constraint on `matching_rules` rejects a rule whose `signal_key` **or** `candidate_field` is prohibited: `not is_prohibited_signal(signal_key) and not is_prohibited_signal(candidate_field)`. The `is_prohibited_signal(text)` function mirrors the domain catalogue exactly.

So even a direct SQL insert — bypassing the application — cannot store a matching rule that reads a prohibited signal on either side.

## 3. No protected-trait inference

The engine must not infer or proxy a protected trait:

- **No name/language/source-based exclusion.** A lead's name, the language it writes in, or its source channel is never a basis for excluding or down-ranking a candidate. Source/language alone cannot disqualify a match.
- **No neighbourhood demographic profiling.** Location matching uses **structured locality data only** (the locality a project is in, distances expressed as trusted stored facts) — never a demographic or socioeconomic profile of a neighbourhood (`neighbourhood_demographic` and `socioeconomic_profile` are explicitly prohibited).
- **Accessibility as an expressed requirement, not inferred health.** An accessibility amenity preference (for example, step-free access, a lift) is matched as an **expressed project requirement** like any other amenity. It is never used to infer a disability or medical status (`disability` and `medical_status` are prohibited).
- **No fabricated travel times.** Travel time is never invented. Distance matching uses only **trusted stored distance facts**; where none exists, the result is **Unknown** rather than a guessed travel time (see [`MATCHING_RULES.md`](./MATCHING_RULES.md) §1, `distance_threshold`).
- **Missing data is not a proxy.** An unknown value contributes nothing and reduces preference completeness; it is never treated as a penalty or a stand-in for a protected trait (see [`MATCHING_RULES.md`](./MATCHING_RULES.md) §9).

## 4. Stale inventory is never shown as confirmed

A fairness-adjacent safety property: a stale or unverifiable unit is never presented as confirmed available. Only `verified_available` yields a confirmed unit; stale/unknown/unavailable inventory is surfaced with a re-verification request, never as a bookable unit (see [`MATCHING_INVENTORY_SAFETY.md`](./MATCHING_INVENTORY_SAFETY.md)). This prevents a misleading "available now" recommendation that a user could not actually fulfil.

## 5. Tests and assertions that prove this

- **Domain unit suites (`packages/domain/src/__tests__/matching.test.ts` and `matching-eval.test.ts`)** include fairness/prohibited-drop cases: `assertNoProhibitedMatchInputs` rejects a prohibited rule/input, and `calculateProjectMatches` drops an injected prohibited input so it cannot influence a match. They also cover determinism, ranking and the stable tie-break, eligibility gates, hard-vs-soft behaviour, inventory safety (verified / stale / not-available), budget outcomes, missing-data handling, and an evaluation dataset (location, excluded-location, amenity, budget, no-fresh-inventory, no-units, multiple-equal, and cross-tenant cases).
- **Embedded-Postgres harness** asserts (among the Phase-6B checks) that a prohibited input is rejected on `matching_rules` (the DB CHECK on both `signal_key` and `candidate_field`), proving the catalogue is enforced independently of the application, alongside cross-tenant SELECT isolation and INSERT denial across all 14 matching tables.

Together these prove the catalogue is enforced in both layers, that location matching uses structured locality data only, that travel times are never fabricated, that accessibility is matched as an expressed requirement rather than inferred health, that missing data is safe, and that source/language/name alone cannot exclude a candidate.
