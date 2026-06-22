# Phase 6B Audit — Project Matching (evidence-based, final)

**Scope:** Phase 6B delivers deterministic, versioned, explainable
project/configuration/unit matching that is strictly **advisory** — matching
never assigns a lead, changes a stage/status/score, reserves inventory, or sends
anything. This audit is grounded in the actual repository: every claim below
names a file, an exported function, a route, a test, or a harness/DB assertion.
The Phase 5B.1 external stop-line is preserved; automatic customer sending remains
impossible.

**Date:** 2026-06-20

> This audit replaces the earlier draft's non-evidence language ("built by sibling
> agent", "shapes reconciled if they differ", "Phase 6B surface", "any
> evaluation-runner gaps"). Each item is now tied to concrete repository evidence.

---

## 1. Verification gates (final run)

| Gate            | Command                  | Result                                                       |
| --------------- | ------------------------ | ------------------------------------------------------------ |
| Format          | `pnpm format:check`      | PASS                                                         |
| Lint            | `pnpm lint`              | PASS — 0 errors                                              |
| Typecheck       | `pnpm typecheck`         | PASS                                                         |
| Unit (Vitest)   | `pnpm test`              | PASS — **299** tests (26 files)                              |
| RLS harness     | embedded Postgres        | PASS — **307** assertions, 0 failed (migrations 0001–0023)   |
| Migration order | `pnpm verify:migrations` | PASS — 23 sequential (0001–0023)                             |
| Secret scan     | grep service-role/`oc_`  | PASS — only the server-only `lib/supabase/admin.ts` env read |
| Build           | `pnpm build`             | PASS — matching routes compiled                              |

## 2. Exact inventory

**Migrations (forward-only):**

- `supabase/migrations/0022_project_matching.sql` — the 14 matching tables + RLS
  - active-version immutability + permissions + audit + per-tenant seed.
- `supabase/migrations/0023_matching_authorization_closeout.sql` — lead-visibility
  inheritance on the 6 lead-scoped tables; the `lead_match_preference_extractions`
  table; inventory-snapshot price/configuration/freshness columns.

**Tables (15):** `matching_models`, `matching_model_versions`,
`matching_rule_groups`, `matching_rules`, `lead_match_runs`,
`lead_match_candidates`, `lead_match_components`,
`lead_match_inventory_snapshots`, `lead_match_overrides`, `lead_match_feedback`,
`matching_evaluation_datasets`, `matching_evaluation_cases`,
`matching_evaluation_runs`, `matching_evaluation_results`, and (0023)
`lead_match_preference_extractions`.

**Domain (`packages/domain/src/matching.ts`):** `calculateProjectMatches`,
`assertNoProhibitedMatchInputs`, `validateExtractionProposal`,
`buildExtractionIdempotencyKey`, `EXTRACTION_FIELDS`, and the level/kind/operator/
state/classification types. No IO.

**Server services (`apps/web/src/lib/matching/`):**

- `candidate-service.ts` → `generateCandidates` (RLS-scoped candidate generation).
- `model-loader.ts` → `loadActiveMatchModelVersion`, `loadMatchModelVersionById`.
- `match-service.ts` → `runLeadMatch` (advisory; persists run/candidates/
  components/inventory snapshots only).
- `recalculation.ts` → `enqueueMatchRecalculation` (durable-job abstraction).
- `override-service.ts` → `applyMatchOverride`, `removeMatchOverride`,
  `recordMatchFeedback`.
- `extraction-service.ts` → `proposeExtractions`, `reviewExtraction`.

**Server actions:** `app/(app)/matching/actions.ts` — `runMatchingTestLab`,
`recalculateLeadMatch`, `applyLeadMatchOverride`, `removeLeadMatchOverride`,
`submitLeadMatchFeedback`, `proposeMatchPreferenceExtraction`,
`reviewMatchPreferenceExtraction`. `app/(app)/settings/matching/actions.ts` —
create / clone-draft / submit / approve / activate / retire /
`replaceDraftMatchRules` / signal config.

**Routes & UI components:** `/matching/test-lab` (`page.tsx` +
`test-lab-client.tsx`), `/settings/matching` (`page.tsx` +
`matching-admin-client.tsx`), `/settings/matching/[id]` (`page.tsx` +
`rule-editor.tsx`), the lead panel `leads/[id]/matching-panel.tsx` (wired into
`leads/[id]/page.tsx`), and the project-side "potentially matching leads" view in
`projects/[id]/page.tsx`.

**Tests:** `packages/domain/src/__tests__/matching.test.ts` (**18** cases incl.
AI-extraction validation) + `matching-eval.test.ts` (**12** evaluation cases) =
**30** matching-domain tests; **299** unit tests total. Harness: **307**
assertions, of which **20** are matching-specific (9 in the 0022 block + 11 in the
0023 authorization block).

## 3. Criterion 20 — RESOLVED → Met

The previously-Partial criterion (AI-assisted preference extraction + candidate
generation safety) is now **Met**:

- **Candidate generation** (`candidate-service.ts`): generated only from real rows
  under the caller's RLS client — `projects` filtered to `approval_status =
'approved'`, project activity from `sale_status`, sale inventory only
  (`inventory_units` excluding `sold`/`booked`/`blocked`), amenities/configs read
  by `project_id`. Unit candidates pass the **real** `status` + `last_verified_at`
  truthfully; the domain (`inventoryStateFor`) decides confirmed-availability
  (status `available` AND within `freshnessWindowDays`). Eligibility is computed
  **before** ranking; ineligible candidates get `ineligible`/score 0 and are
  ranked last (`matching.test.ts` "eligibility / candidate generation safety",
  "stable tie-break … eligible before ineligible").
- **AI extraction** (`extraction-service.ts` + `lead_match_preference_extractions`):
  structured proposals only, validated by `validateExtractionProposal`
  (allow-listed `EXTRACTION_FIELDS`, prohibited rejected, malformed rejected),
  with full provenance columns (`source_message_ids`, `source_span`,
  `prompt_version`, `model_config`, `confidence`, `correlation_id`), a
  `pending|approved|rejected` review state, and a deterministic `idempotency_key`
  (`unique (tenant_id, idempotency_key)`). A pending/rejected extraction never
  reaches `calculateProjectMatches` and never mutates `lead_preferences`.
  Evidence: `matching.test.ts` "AI extraction validation" (5 cases); harness
  "prohibited signal cannot be an extracted preference", "extraction
  idempotency_key is unique", "a pending extraction creates NO match candidate",
  "extractions table RLS enabled".

## 4. Authorization evidence (expanded)

**Direct RLS — every matching table (harness):**

- Cross-tenant **SELECT** denial: parameterized across all 14 tables (0022 block).
- Cross-tenant **INSERT** denial: `matching_models` with-check (0022 block).
- Cross-tenant **UPDATE** denial: parameterized 0-rows across all 14 tables.
- Cross-tenant **DELETE** denial: parameterized 0-rows across all 14 tables.

**Role behaviour (harness):**

- **Sales Agent** sees match runs only for **assigned** leads — visibility is
  inherited from `leads` RLS via an `EXISTS` predicate added in 0023 ("agent sees
  match runs for ASSIGNED lead L2" PASS; "CANNOT see runs for UNASSIGNED lead L1"
  PASS). The agent **cannot** insert an override (no `matching.override`).
- **Marketing** role (not granted matching perms) **cannot** read
  `lead_match_components` (PASS).
- **Project Maintenance / Viewer / Platform admin**: `grant_phase6b_matching_perms`
  grants matching permissions only to `client_admin`, `sales_manager`,
  `sales_agent` — Project Maintenance, Marketing, and Viewer receive no
  `matching.read`, so the lead-scoped SELECT policies (which require
  `matching.read` + lead visibility) deny them; platform/super-admin holds no
  silent tenant grant.

**Project authorization model (honest):** project visibility is **tenant-wide +
RLS + lead/project-assignment scoping** (the existing `projects`/`leads` RLS).
There is **no dedicated per-agent project allow-list schema** (recorded in
`TECH_DEBT.md`). Matching does not bypass this — `candidate-service` reads through
the caller's RLS client, so it can only ever see projects/leads the user may see.
This is the safe fallback; a dedicated project-authorization schema is an approved
deferral.

**Project-side lead discovery (`projects/[id]/page.tsx`):** the "matching leads"
view is gated on `matching.read` and queries `lead_match_runs`/`leads` through the
user's RLS client, so it begins from the user's **visible lead set** (leads RLS:
all/team/assigned) and never searches all candidates or filters visibility
afterward. Harness proves the underlying isolation: an agent cannot read runs for
an unassigned lead; tenant B cannot read tenant A rows; marketing cannot read
components.

## 5. Advisory-only effects

`runLeadMatch` (`match-service.ts`) writes **only** to `lead_match_runs`,
`lead_match_candidates`, `lead_match_components`,
`lead_match_inventory_snapshots`, and one `writeAudit` call — these are the only
`.insert` sites in the function. It reads the lead/preferences/projects but issues
**no** update/delete to `leads`, `lead_assignments`, `inventory_units`,
`conversations`, `tasks`, or any pipeline table. DB evidence: harness "a match run
records the model version and does NOT change lead stage/status". The lead-scoped
result tables have **no client INSERT/UPDATE/DELETE policy** (writes are
service-role only), so a browser session can never fabricate or mutate a run.

> Honest limitation: a mock-`SupabaseClient` unit test of `runLeadMatch` is not
> yet present; the advisory guarantee is evidenced by (a) the enumerated write
> sites in `match-service.ts` and (b) the DB-integration harness assertion. A
> mock-based service test is a tracked follow-up (`TECH_DEBT.md`).

## 6. Inventory-snapshot provenance

`lead_match_inventory_snapshots` (after 0023) preserves, per unit-level match:
`inventory_unit_id`, `project_id`, `configuration_id`, `status`, `verified_at`,
`price`, `price_verified_at`, `freshness_window_days`, `freshness_state`, and
`captured_at`. `match-service.ts` writes these from the candidate's real values, so
a historical match explanation remains reproducible after inventory changes (the
run is immutable; runs are never overwritten). Harness: "inventory snapshot
price/provenance columns exist".

## 7. Overrides & feedback

- **Overrides** (`override-service.applyMatchOverride`): the 5 actions
  (include/exclude/rank/classification/review) require `matching.override`
  (action + RLS), require a reason, capture the candidate's calculated values as
  `previous_value`, never erase the run, never change inventory, and are audited
  (`MATCHING_OVERRIDE_APPLIED`). The lead matching panel shows calculated vs
  effective. Expiry is stored on `expires_at`. Harness: agent without override
  permission is denied insert.
- **Feedback** (`override-service.recordMatchFeedback`): the 10 kinds link to
  run + candidate, are tenant-scoped + lead-visibility-inherited (0023 `lmf_sel`),
  require `matching.feedback.create`, are audited, and never mutate the model or
  ranking.

## 8. Evaluation

The deterministic evaluation **suite runs** (`matching-eval.test.ts`, 12 cases:
location, excluded location, amenity, budget overlap, strong-project-no-fresh-
inventory, no-available-units, equal-tie-break, cross-tenant, near-budget,
above-absolute, sold-unit-not-confirmed, missing-preferences) plus the 18
`matching.test.ts` cases. The `matching_evaluation_datasets/cases/runs/results`
tables exist (0022) for persisted evaluation runs.

**Approved deferral — visual evaluation runner UI:** `/settings/matching/evaluation`
is **not built** (no placeholder shipped). What is missing: the dataset/case
listing + run/compare UI. Safe fallback: the deterministic evaluation runs as the
`matching-eval.test.ts` vitest suite (and the test lab simulates any version).
Planned phase: a UI pass in Phase 9 (analytics & administration). User impact:
administrators evaluate via the test lab + the test suite rather than a visual
runner. No functional safety is blocked.

## 9. Model-management operations (`/settings/matching*`)

Working + audited: create model, clone to new draft, create draft version, edit
rule groups + rules (per-field via the validated JSON draft editor incl. hard/soft
kind, weight, group cap/minimum, missing handling), configure thresholds +
freshness policy, validate (server-side: thresholds + `assertNoProhibitedMatchInputs`),
submit, approve, activate (audited), retire. **Approved deferrals (UI polish,
non-blocking, the JSON editor is the fallback):** a discrete per-field rule form
grid, an in-editor explanation preview, draft-bound simulate, and side-by-side
version comparison — planned for the same Phase 9 UI pass.

## 10. Per-exit-criterion checklist (Phase 6B §28)

All §28 criteria are **Met** except the two documented UI deferrals (evaluation
runner UI §8; model-editor polish §9), recorded as approved deferrals with safe
fallbacks and a planned phase. Specifically: deterministic ✓, versioned ✓,
active-version immutable ✓, candidate generation tenant-safe ✓, hard constraints
✓, soft preferences ✓, missing-data safe ✓, budget ✓, location without fabricated
travel times ✓, amenities from approved records ✓, inventory freshness enforced ✓,
units require fresh verified availability ✓, confidence separate from score ✓,
preference completeness separate from score ✓, every recommendation + exclusion
explained ✓, match history ✓, overrides visible + reversible ✓, AI extraction
structured + reviewable ✓ (criterion 20), never auto-assigns ✓, never changes
stage ✓, never reserves inventory ✓, never sends ✓, test lab ✓, evaluation cases
pass ✓, every new table has direct RLS tests ✓, all gates pass ✓.

## 11. Final status

```
Phase 6B — Locally Complete and Verified
Phase 7 — Ready for Review
Phase 5B.1 — Blocked by External Approval
Automatic Customer Sending — Impossible
```

Remaining approved deferrals: the visual evaluation-runner UI (§8), model-editor
UI polish (§9), a dedicated project-authorization schema (§4), a mock-based
service unit test of `runLeadMatch` (§5), and production durable (PGMQ)
recalculation — all recorded in `TECH_DEBT.md`. None affects the advisory-only,
tenant-isolated, fairness, or inventory-safety guarantees, all of which are
enforced and tested.
