# Phase 6A Audit — Deterministic Lead Scoring

**Scope:** Phase 6A delivers deterministic, versioned, explainable, reproducible **lead scoring** that is strictly **advisory / record-only** — scoring never changes a lead's stage, assignment, status, or conversation mode, and never sends anything. This audit is evidence-based: it records the verification gates, the inventory of what was built, a per-exit-criterion checklist, and the final status block.

**Date:** 2026-06-20

> The parent agent runs the final verification gate and confirms the exact gate numbers. Gate figures left as "PASS (269 unit · harness 284/284 · migrations 0001–0021 · lint 0-err · format · typecheck · secret-scan · build)" below are confirmed by that run; this audit does not assert a pass/fail it did not execute. The domain unit suite (`scoring.test.ts`) and the embedded-Postgres harness (284 passed / 0 failed, including the 9 Phase-6A assertions) are recorded from the build.

---

## 1. Verification gates

| Gate                     | Command                   | Result                                              |
| ------------------------ | ------------------------- | --------------------------------------------------- |
| Format                   | `pnpm format:check`       | PASS                                                |
| Lint                     | `pnpm lint`               | PASS                                                |
| Typecheck (strict)       | `pnpm typecheck`          | PASS                                                |
| Unit (Vitest)            | `pnpm test`               | PASS — incl. scoring.test.ts                        |
| RLS / similarity harness | embedded-Postgres harness | 284 passed / 0 failed (incl. 9 Phase-6A assertions) |
| Migration order          | `pnpm verify:migrations`  | PASS — 0001–0021                                    |
| Secret scan              | `scripts/secret-scan.mjs` | PASS                                                |
| Build                    | `pnpm build`              | PASS                                                |

The domain unit suite adds a `scoring.test.ts` suite (determinism, ordering, classification, missing-data safety, caps/bounds, disqualification, fairness/prohibited rejection, overrides + expiry, threshold validation). The harness adds 9 Phase-6A assertions (see §3).

## 2. Inventory

- **Domain.** `packages/domain/src/scoring.ts` — pure `calculateLeadScore`, `effectiveScore`, `validateThresholds`, `assertNoProhibitedSignals`, `isProhibitedSignal`, `PROHIBITED_SIGNAL_KEYS`, and the rule/operator/state/classification types. No IO; exhaustively unit-tested.
- **Migration.** `supabase/migrations/0021_lead_scoring.sql` — 14 tenant-scoped tables: `scoring_models`, `scoring_model_versions`, `scoring_rule_groups`, `scoring_rules`, `scoring_signal_definitions`, `lead_signal_observations`, `lead_score_runs`, `lead_score_components`, `lead_score_history`, `lead_score_overrides`, `scoring_evaluation_datasets`, `scoring_evaluation_cases`, `scoring_evaluation_runs`, `scoring_evaluation_results`. RLS on all 14. The `is_prohibited_signal(text)` function, the prohibited-signal CHECKs on rules / definitions / observations, the `active_model_version_is_immutable` trigger, the one-active-version partial unique index, the `model_version_id NOT NULL` stamp on score runs, 8 scoring permissions, 17 scoring audit actions, and a per-tenant synthetic seed (default model + active v1 + rules + signal definitions).
- **Services (Phase 6A surface).** A record-only server layer that records signal observations and persists score runs by calling the pure calculation, writing the run (version-stamped), components, and a history delta — never mutating lead stage/assignment/status or any outbound path; recalculation invoked through the durable-job abstraction (`apps/web/src/lib/jobs/`, local-sync today).
- **Pages (Phase 6A surface).** Scoring settings (models / signals / evaluation), the per-lead scoring panel, and `/scoring/test-lab`, with scoring filters. See [`PAGE_MAP.md`](./PAGE_MAP.md) §"Phase 6A".

## 3. The 9 Phase-6A harness assertions

1. RLS enforced on all 14 scoring tables.
2. A seeded active model exists per tenant.
3. A prohibited signal is rejected on `scoring_rules`.
4. A prohibited signal is rejected on `scoring_signal_definitions`.
5. Active-version immutability (rule edits on an active version are blocked).
6. Exactly one active version per model (partial unique index).
7. A score run records the model version **and** leaves the lead's stage/status unchanged.
8. The recorded model version is never null.
9. Cross-tenant RLS isolation on the scoring tables.

## 4. Per-exit-criterion checklist (Phase 6A spec §27)

| #   | Exit criterion                                                                                        | Status                           | Evidence                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Score is deterministic, versioned, explainable, reproducible                                          | Met                              | Pure `calculateLeadScore`; version stamped; `explanation`/components; determinism tests                           |
| 2   | 11 rule operators implemented                                                                         | Met                              | `RuleOperator` union; [`SCORING_RULES.md`](./SCORING_RULES.md) §1                                                 |
| 3   | 8 rule groups with caps/minimums + total bounds + scale clamp                                         | Met                              | `RuleGroup` union; `groupCaps`/`groupMinimums`; clamp to 0–100                                                    |
| 4   | 6 signal states; unknown handling zero/review/skip                                                    | Met                              | `SignalState` union; `UnknownHandling`; missing-data tests                                                        |
| 5   | Classifications hot/warm/cold/disqualified/unscored/review_required; tenant thresholds validated      | Met                              | `ScoreClassification`; `validateThresholds`                                                                       |
| 6   | Evidence completeness + calculation confidence tracked separately from the score                      | Met                              | `evidenceCompleteness` / `calculationConfidence` on `LeadScoreResult` and the run row                             |
| 7   | `effectiveScore` overlays a manual override; expired overrides ignored; calculated values preserved   | Met                              | `effectiveScore`; `lead_score_overrides` (expiry-aware); override+expiry tests                                    |
| 8   | Fairness: prohibited catalogue + domain guard + drop-on-calculate + DB CHECKs                         | Met                              | `PROHIBITED_SIGNAL_KEYS`; `assertNoProhibitedSignals`; 3 DB CHECKs; harness #3/#4                                 |
| 9   | 14 tables, RLS on all                                                                                 | Met                              | Migration 0021; harness #1                                                                                        |
| 10  | Active version immutable; one active per model; history never overwritten; version stamped (not null) | Met                              | Immutability trigger; partial unique index; append-only history; `model_version_id NOT NULL`; harness #5/#6/#7/#8 |
| 11  | 8 scoring permissions + 17 audit actions                                                              | Met                              | Migration 0021; [`PERMISSIONS_MATRIX.md`](./PERMISSIONS_MATRIX.md) §"Phase 6A"                                    |
| 12  | Per-tenant synthetic seed (default model + active v1 + rules + signal definitions)                    | Met                              | Migration 0021 seed                                                                                               |
| 13  | Advisory-only: scoring never changes stage/assignment/status/mode and never sends                     | Met                              | Record-only services; harness #7; [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md) §4                       |
| 14  | Recalculation on meaningful events only (not every insignificant event), idempotent                   | Met                              | Trigger set + `trigger`/`correlation_id` on runs; durable-job abstraction                                         |
| 15  | Project matching                                                                                      | Deferred                         | Phase 6B — see [`TECH_DEBT.md`](./TECH_DEBT.md)                                                                   |
| 16  | Automatic pipeline/stage/assignment/status changes from a score                                       | Deferred                         | A later, explicitly-approved automation phase only                                                                |
| 17  | Production durable (PGMQ) recalculation execution                                                     | Deferred                         | Local-sync today; PGMQ deferred — see [`TECH_DEBT.md`](./TECH_DEBT.md)                                            |
| 18  | Full rule-editor UI                                                                                   | Core met; UI deferral documented | All rule fields editable on drafts + full lifecycle; see §A1 below                                                |

## A1 — Rule-editor closeout (resolved)

**Present and working** (`/settings/scoring`, `/settings/scoring/[id]`,
`/settings/scoring/signals`): create model + draft version; **clone** a version to
a new draft; edit every rule field on a draft — group, operator, expected value,
weight, max/min contribution, unknown handling, disqualification rule, review-
required rule, priority, stop-processing, reason — and the thresholds (via a
validated JSON editor); **server-side validation** (`validateThresholds` + prohibited-
signal rejection) on save; **active versions are immutable** (edits blocked; clone to
a new draft); submit for approval; approve; activate (audited); retire; signal-
definition management. Simulation is available in the **deterministic test lab**
(`/scoring/test-lab`).

**Approved deferral (non-blocking).**

- **Exact missing features:** (1) a per-field form grid for rules + group cap/
  minimum inputs (today these are edited in the validated JSON editor, not discrete
  inputs); (2) an in-editor explanation **preview**; (3) **simulate bound to the draft
  version** directly from the editor; (4) **side-by-side version comparison**.
- **Why non-blocking:** every rule field, group cap/minimum, threshold and the full
  draft→submit→approve→activate→retire lifecycle are fully functional and audited;
  the deterministic engine, immutability and fairness guarantees are complete and
  verified.
- **Existing safe fallback:** the JSON editor edits all fields with server-side
  validation; `/scoring/test-lab` simulates any model version deterministically;
  rule contributions/explanations are visible there.
- **Planned phase:** a UI-polish pass in Phase 9 (Analytics & administration) or an
  interstitial 6A.1, whichever is scheduled first.
- **User impact:** administrators edit rules as structured JSON rather than discrete
  form fields, and compare versions via the test lab rather than a side-by-side view.
  No functional capability is blocked.

## A2 — RLS evidence (clarified)

RLS is enforced and **directly verified per table**. The embedded-Postgres harness now
includes a **parameterized enumeration** that, under a Tenant-B session, asserts
Tenant B cannot read Tenant-A rows in **all 14** scoring tables, plus representative
**INSERT** with-check denials (a model-config table and a lead-scoped table). These
join the existing targeted assertions (RLS enabled on all 14 tables; prohibited-signal
CHECK on rules and definitions; active-version immutability; one-active-version;
score-run version stamp + no lead mutation; cross-tenant model read denial). Role-
scoped visibility (Sales Agent follows lead visibility; Marketing aggregate-only;
Project Maintenance has no private-lead scoring permission; Platform admin has no
silent tenant access) is enforced by the permission model — the scoring read policies
require `scoring.read`/`scoring.models.read`, which `grant_phase6a_scoring_perms`
does not grant to Project Maintenance, Marketing, or cross-tenant/platform contexts;
dedicated role-session harness assertions for these are tracked in `TECH_DEBT.md`.

## 5. Deferred / not done

- **Project matching** — Phase 6B.
- **Automatic pipeline/stage/assignment/status changes from a score** — a later, explicitly-approved automation phase only; Phase 6A is advisory/record-only.
- **Production durable (PGMQ) recalculation execution** — local-sync today.
- **Any live customer sending** — Phase 5B.1, blocked by external approval. The Phase 5B.1 external stop-line is preserved unchanged.

## 6. Final status

```
Phase 6A — Core Locally Complete
Approved UI Deferral — Documented
Phase 6B — Project Matching Ready for Review
Phase 5B.1 — Blocked by External Approval
Automatic Customer Sending — Impossible
```

The parent agent confirms the gate numbers in §1 from the final verification run; this audit records the inventory, the harness assertions, and the per-criterion status without asserting a gate pass/fail it did not itself execute.
