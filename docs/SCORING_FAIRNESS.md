# Scoring Fairness (Phase 6A)

Deterministic scoring must never use protected traits, and must never let source, language, or missing data act as a hidden proxy for them. This document defines the prohibited-signal catalogue, the two enforcement layers, the non-inference rules, and the tests and harness assertions that prove these properties.

It complements [`SCORING_SIGNALS.md`](./SCORING_SIGNALS.md) and [`SECURITY.md`](./SECURITY.md).

---

## 1. Prohibited-signal catalogue

The domain layer defines `PROHIBITED_SIGNAL_KEYS` — signal keys that may never participate in scoring:

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

A rule, a signal definition, or an observation that targets any of these is rejected. No scoring rule may read a prohibited signal, and no prohibited observation may be recorded or used.

## 2. Two enforcement layers

Fairness is enforced in depth — in the pure domain layer and again in the database — so neither a code path nor a direct database write can slip a prohibited signal in.

### 2.1 Domain layer (`packages/domain/src/scoring.ts`)

- **`assertNoProhibitedSignals(rules)`** throws if any rule targets a prohibited signal; it is used at model-configuration time so a model carrying a prohibited rule cannot be built.
- **Drop-on-calculate.** `calculateLeadScore` drops any prohibited observation even if one is injected into its input, so a prohibited signal can never contribute to a score regardless of how it reached the function.
- **`isProhibitedSignal(key)`** is the shared predicate behind both.

### 2.2 Database layer (`supabase/migrations/0021_lead_scoring.sql`)

- An `is_prohibited_signal(text)` SQL function mirrors the domain catalogue exactly.
- A CHECK constraint on `scoring_rules` (`scoring_rule_not_prohibited`) rejects a rule whose `signal_key` is prohibited.
- A CHECK constraint on `scoring_signal_definitions` (`scoring_signal_not_prohibited`) rejects a prohibited signal definition.
- A CHECK constraint on `lead_signal_observations` (`observation_not_prohibited`) rejects a prohibited observation at write time.

So even a direct SQL insert — bypassing the application — cannot store a prohibited rule, definition, or observation.

## 3. No protected-trait inference

The engine must not infer a protected trait from a proxy:

- **No inference from names, language, photos, addresses, or writing style.** None of these may be turned into a protected-trait signal (`name_demographic`, `neighbourhood_demographic`, `accent` are explicitly prohibited).
- **Source or language alone cannot disqualify.** A lead's channel or the language it writes in is never a hard rule by itself; source influences the score only through tenant-approved rules bounded by the source-group cap (see [`SCORING_SIGNALS.md`](./SCORING_SIGNALS.md) §4).
- **Missing data is not automatically negative.** An unknown signal contributes zero and reduces evidence completeness; it never disqualifies and is never treated as a penalty (see [`SCORING_RULES.md`](./SCORING_RULES.md) §8).

## 4. Tests and harness assertions that prove this

- **Domain unit suite (`packages/domain/src/__tests__/scoring.test.ts`)** includes fairness/prohibited-rejection cases: `assertNoProhibitedSignals` throws on a prohibited rule, and `calculateLeadScore` drops an injected prohibited observation so it cannot contribute. It also covers determinism, ordering, classification, missing-data safety (unknown contributes zero, never disqualifies), caps/bounds, disqualification short-circuit, overrides and expiry, and threshold validation.
- **Embedded-Postgres harness** asserts (among the nine Phase-6A checks) that a prohibited signal is rejected on `scoring_rules` and on `scoring_signal_definitions`, proving the DB CHECK and the `is_prohibited_signal` function enforce the catalogue independently of the application.

Together these prove the catalogue is enforced in both layers, that missing data is safe, and that source/language alone cannot disqualify.
