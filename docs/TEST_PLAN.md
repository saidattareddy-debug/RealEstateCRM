# Test Plan

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §31. Tooling: Vitest + React Testing Library (unit/component), pgTAP/SQL (database/RLS), Playwright (E2E + accessibility). **A phase is not complete while its tests fail.** CI (GitHub Actions) runs all layers.

---

## 1. Test layers & ownership

| Layer         | Tool                            | Scope                                                                 |
| ------------- | ------------------------------- | --------------------------------------------------------------------- |
| Unit          | Vitest                          | Pure logic in `packages/domain`, `packages/validation`, `packages/ai` |
| Component     | Vitest + RTL                    | `packages/ui` and key app components incl. four-state rendering       |
| Database      | pgTAP / SQL in `supabase/tests` | RLS, constraints, triggers, functions, history                        |
| Integration   | Vitest (mocked providers)       | Connectors, webhooks, parsers, queue retry, AI fallback               |
| E2E           | Playwright                      | Critical user journeys across the real app                            |
| Accessibility | Playwright + axe                | Keyboard, focus, labels, contrast, landmarks, dialogs, touch targets  |

## 2. Unit tests (deterministic core)

- **Scoring** ([`SCORING_ENGINE.md`](./SCORING_ENGINE.md)): each component's points and caps; mutually-exclusive budget tiers; hard-disqualification short-circuit; negative-signal accumulation (24h/72h/7d); **category threshold boundaries (44/45, 74/75)**; temporary-Hot on confirmed site-visit request; non-response → Dormant (not Disqualified); rule priority/cap/effective-date; historical-simulation reproducibility (same inputs + rule version → same score).
- **Project matching:** hard filters never return Booked/Sold/Unavailable units; ranking order; match-percentage math; "info still needed" output.
- **Dedupe:** phone (E.164 + national), email, alternate phone, source ID, fuzzy-name + second-identifier, campaign+contact window; confidence-level classification; merge preserves messages/sources/attribution/notes/score history/assignments/documents and is reversible.
- **Assignment:** eligibility filtering, language match, workload limits, weighted round-robin, **manual assignment not overwritten** without explicit rule, reason recorded.
- **Follow-up branching:** score-aware sequence selection, working/quiet-hour gating, all stop conditions (site visit booked, takeover, opt-out, wrong number, DNC, booked, lost, disqualified, complaint, manager stop), "why sent" recorded.
- **Permission helpers:** effective-permission resolution (role ⊕ user overrides); scoped checks.
- **Validation:** Zod schemas accept valid / reject invalid payloads.
- **AI structured-output parsing:** valid objects parse; malformed/unsafe rejected → fallback/escalation.

## 3. Database tests (pgTAP / SQL)

- **RLS / tenant isolation:** user of tenant A cannot read or write tenant B rows on **every** tenant-owned table.
- **Role scope:** Sales Agent sees only assigned leads/conversations; **Project Data & Maintenance cannot read private conversations**; Viewer cannot mutate.
- **Constraints:** FKs, checks (inventory status enum, document status enum, E.164 format), uniqueness.
- **Triggers & functions:** `updated_at`, audit-log writes, history appends.
- **History integrity:** `score_events`, `lead_stage_history`, `inventory_status_events`, `inventory_price_history` append-only and complete.

## 4. Integration tests (mocked external providers)

- **WhatsApp webhook:** signature verification, idempotency (no double lead/message), inbound normalization, delivery/read/failure handling.
- **Lead-form / generic webhook:** authenticity, raw-event persistence, idempotency, normalization, dedupe path.
- **Gmail parser:** source-specific + generic parsing; sender-domain/pattern validation; duplicate-processing avoidance.
- **Calendar sync:** booking, reschedule, cancel, **double-booking prevention**, status sync without token exposure.
- **Document ingestion:** extraction → chunking → embedding → retrievable only when Approved; **prompt-injection resistance** (instructions inside documents are ignored).
- **AI-provider fallback:** primary failure/invalid output → next model; `fallback_used` recorded.
- **Queue retry:** backoff, max attempts, dead-letter, manual replay, idempotent reprocessing.
- **Import mapping:** arbitrary columns → product fields; per-row errors reported.

## 5. End-to-end tests (Playwright)

Cover the spec's journeys against the running app with synthetic data: tenant onboarding · user invitation · project creation · document upload + approval · lead arrival (webhook/form/WhatsApp/CSV) · duplicate merge · AI qualification · score calculation · agent assignment · human takeover · site-visit booking · pipeline movement · opt-out (do-not-contact enforced) · reporting reflects real data.

## 6. Accessibility tests

Keyboard navigation through primary flows; visible focus; correct labels/roles; colour contrast (both themes, WCAG AA); screen-reader landmarks; dialog focus-trap and escape; mobile touch-target sizing. Run via Playwright + axe on key pages each phase.

## 7. CI gates (GitHub Actions)

Per PR / per phase: format check · lint · type check (strict) · unit · component · database tests · build · E2E (where feasible) · migration validation · dependency & secret scanning. **Red CI blocks phase completion.**

## 8. Per-phase test exit criteria

Each phase ([`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)) defines which suites must be green before it is marked complete in [`BUILD_STATUS.md`](./BUILD_STATUS.md). New tenant tables require new RLS tests in the same phase; new external surfaces require integration + security tests in the same phase.

## 8a. Phase 1.1 RLS coverage

Every Phase-1 tenant-owned table now has **explicit** RLS assertions (no "pattern-covered"): `tenants`, `tenant_branding`, `tenant_settings`, `tenant_features`, `profiles`, `roles`, `role_permissions`, `memberships`, `user_permissions`, `invitations`, `audit_logs`, `security_events`. Per table: own vs cross-tenant SELECT/INSERT/UPDATE/DELETE, non-member denial, member-without-permission denial, and super-admin-no-silent-access. Scenario tests: tenant-switch validation, forged active-tenant claim, missing claim, disabled membership, revoked permission, granted override, maintenance/viewer/agent invariants, audit append-only immutability.

- **Official:** `supabase/tests/0002_rls_full_coverage_test.sql` (pgTAP, 51 assertions) + `0001_rls_tenant_isolation_test.sql`, run by `supabase test db` in CI.
- **Local (no Docker):** `supabase/tests/local-harness/run.mjs` boots an embedded Postgres, applies migrations from clean + seed, and runs the equivalent set — **last result 56 passed, 0 failed**. It is a developer convenience, not authoritative; no migration depends on it.
- **Audit unit tests:** `packages/validation/src/__tests__/audit.test.ts` (catalogue integrity + secret redaction).

## 9. Test data

Synthetic seed only (`supabase/seed`) — never real names/phones from prototype screenshots (§28). Factories generate deterministic fixtures for unit/integration tests.

## Phase 3.1 coverage (idempotency & CRM)

**Unit (Vitest, `packages/domain`):** retry/backoff (`retry.ts` — retry → backoff
→ exhausted → dead-letter) and qualification completeness (`qualification.ts` —
required/important/overall, blanks-as-missing, disabled excluded, "not a quality
score"). Total suite: **52 passed**.

**RLS + idempotency harness** (`supabase/tests/local-harness/run.mjs`, embedded
Postgres, migrations 0001–0010 from a clean DB + seed, run as non-superuser
`authenticated`): **123 passed, 0 failed**. New assertions:

- **Idempotency:** same `(tenant, key)` twice rejected; same key under a different
  tenant allowed; same `(tenant, source, external_event_id)` twice rejected even
  with a different idempotency key; `idempotency_keys` uniqueness.
- **Calls RLS:** visible only on assigned lead; not on unassigned lead; agent can
  log on assigned lead; cross-tenant denial. (Caught the `FOR ALL` SELECT-widening
  bug.)
- **Saved views:** owner-only write; private invisibility to others; cannot create
  a view owned by another user.
- **Qualification fields:** member read; agent cannot edit config; admin can.
- **Ingestion events / jobs / DLQ:** admin sees, agent sees 0, cross-tenant 0.
- **Public forms:** admin (`forms.manage`) sees/creates; agent sees 0 and cannot
  create; cross-tenant 0.

> The harness is developer-convenience; the authoritative DB verification remains
> `supabase test db` (pgTAP) on a Docker/live-Supabase CI runner — part of the
> deferred _Production Verification — Pending_ gate.

## Phase 4 coverage (conversations)

**Unit (Vitest, `packages/domain`):** `buildDeterministicSummary` (unanswered
question detection, answered-after, empty log), `isContactable` (channel + `any`
DNC, unrelated channel allowed, no-record allowed), `needsResponse` (overdue past
SLA, answered, closed). Total suite: **62 passed**.

**RLS harness** (migrations 0001–0011 from a clean DB + seed): **138 passed,
0 failed**. New Phase 4 assertions: admin (`read.private`) sees both
conversations; agent (`read.assigned`) sees only the assigned-lead conversation
and its messages, not the hidden one; agent can reply/takeover on visible
conversations but cannot update hidden ones; cross-tenant denial; maintenance
role bundle excludes both conversation read permissions; consent write by
`leads.update` + cross-tenant denial; widget config visible/creatable only with
`settings.org.manage`.

## Phase 4.1 coverage (AI safety & inbox)

**Unit (Vitest):** `ai-guard.test.ts` (responder-off always denies, fully-enabled
still denied, non-open lifecycles denied, resume-never-ai); `inbox.test.ts`
(waiting-on incl. internal-note/failed-outbound/system/closed; delivery-transition
legality incl. retry; safe canned substitution incl. unknown-variable rejection +
no HTML eval; SLA on-track/due-soon/breached/paused). Suite: **85 passed**.

**RLS + idempotency harness** (migrations 0001–0012, clean DB + seed):
**166 passed**. New Phase 4.1 assertions: permission backfill (agent has
notes.create, lacks redact/dnc/view_sessions/canned/consent; admin has them;
marketing metadata-only); operating_mode default `human`; notes RLS (visible-conv
only); read-state isolation (own row only, cannot mark for others);
canned/DNC/redaction permission gating + cross-tenant denial; message ingestion
idempotency (same key, same `(tenant,widget,external)`, cross-tenant allowed; ops
visibility); website-session visibility (`view_sessions`); summary-version CHECKs
(reject `ai_generated`, reject model on manual). Producer-wiring and UI-level
integration tests are pending with their features (see `TECH_DEBT.md`).

## Phase 4.1 final wiring (2026-06-19)

Unit tests now total **146** (16 files). Added: `polling.test.ts` ×13 (hydration, incremental arrival, equal-timestamp ordering, duplicate response, cursor replay, network failure, reconnect/back-off, hidden-tab cadence, closed-conversation stop), `sla-events.test.ts` ×9 (every SLA lifecycle transition incl. due-recalculated with previous due), `eligibility.test.ts` ×10 (each exclusion signal + multi-reason). The embedded-Postgres RLS harness totals **197** assertions (migrations 0001–0016), adding SLA-event lifecycle-kind + provenance checks, membership eligibility defaults, teams read/write RLS (`assignment.configure`), and canned-reply-usage tenant isolation. Deferred: official `supabase test db` (pgTAP) on a live project.

## Phase 5A (2026-06-20)

Phase 5A adds unit coverage for the AI/knowledge foundation and extends the RLS harness with Phase-5A assertions.

**New unit tests** (`packages/domain/src/__tests__`):

- `chunking.test.ts` — deterministic chunking: stable checksums, semantic-section splitting, FAQ-pair atomicity, no mid-paragraph/list/table splits, over-long-token handling.
- `ai-foundation.test.ts` — the cross-cutting foundation suite: providers (deterministic mock embeddings, cosine similarity, dev-labelled chat, safe error normalization), grounding (grounded only with sufficient evidence + citation coverage; conflict/stale precedence; policy/language escalation; unsupported vs insufficient), escalation (high-stakes precedence + priority mapping), knowledge lifecycle + conflicts (state machine, `isRetrievable`, `canApprove`, conflict detection/auto-resolve), retrieval rerank (deterministic ordering, dedup, independent-source count), prompt injection (category-only detection, untrusted-content wrapping), language routing (script detection, native-preference + fallback + escalate), and cost/usage limits (per-limit blocks, circuit breaker, fan-out clamp, retry caps).
- `ai-guard.test.ts` — the operating levels: `automatic` always denied with the Phase-5B reason, `maySendAutomatically` always the literal `false`, drafting permitted only when every generation gate passes.
- `ai-eval.test.ts` — the evaluation scorer across all dimensions (grounding/escalation/citation/unsupported-claim/isolation/tool/language/draft-discipline) and the aggregate summary.

**RLS harness — Phase-5A assertions:** the embedded-Postgres harness adds checks that the provisioning functions run on tenant creation (mock providers/models, usage limits, disabled default policy), that role grants match the matrix (including `project_maintenance` having knowledge management but **no** `ai.runs.read`), that every Phase 5A table enforces tenant isolation, that the `ai_runs` `mode <> 'automatic'` CHECK rejects an automatic run, that retrieval scope returns only approved + in-project (or tenant-global) + within-effective-window chunks (rejecting draft/rejected/superseded/expired/cross-tenant/cross-project rows), and that the synthetic evaluation dataset is seeded and isolated per tenant.

## Phase 5B.0 (2026-06-20)

Phase 5B.0 hardens the **record-only** responder; a customer-visible automatic send is impossible by construction (see [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md)). Tests prove the record-only invariants hold and that the live-send domain core is fail-safe.

**New unit tests** (`packages/domain/src/__tests__/ai-live-send.test.ts`):

- **Master-switch off with all flags on** — `evaluateLiveSendGates` returns `allowed = false` even when every DB-style flag (platform/tenant/channel/project/mode/consent/provider/usage/grounding/citation/transport/revalidation) is set permissive; the compile-time `LIVE_SEND_MASTER_SWITCH` dominates.
- **Idempotency determinism / sensitivity** — `buildAutomaticSendIdempotencyKey` is stable for identical inputs and changes when any composed part (tenant, conversation, triggering inbound message, responder policy version, prompt version, model config, knowledge snapshot, attempt type) changes.
- **Stale cancellation reasons** — `shouldCancelStaleCandidate` returns each reason (candidate_expired, kill_switch_active, human_takeover, conversation_closed, human_replied, newer_customer_message, dnc_activated, consent_changed, knowledge_withdrawn, inventory_stale).
- **Worker revalidation never proceeds** — `revalidateAutomaticSend` never authorises a send while the master switch is false.
- **The four simulation transports** — dry-run, failure (retryable), timeout (uncertain), and success-simulation (sets a `sim-<key>` ref with `simulated: true`, creates no customer message).
- **Reconciliation never resends** — `reconcileUncertainAttempt` routes uncertain/timeout to manual review and never resends; a known provider ref is treated as confirmed.

**RLS harness — the 8 new Phase-5B.0 assertions:** no `live` enum value in `responder_runtime_mode`; no `delivered`/`sent` value in `send_candidate_status`; the five new tables (`responder_channel_settings`, `responder_activation_requests`, `responder_activation_approvals`, `ai_send_candidates`, `ai_send_attempts`) enforce RLS; a candidate cannot be marked delivered; idempotency uniqueness per tenant; a simulated candidate creates no customer message; a requester cannot self-approve their own activation (the `responder_approval_requester_guard` trigger); and tenant-B isolation on the new tables.

**Totals:** domain unit tests **233**; embedded-Postgres RLS + similarity harness **275 passed / 0 failed** (migrations 0001–0020). The harness has no pgvector and uses a portable in-SQL cosine; pgvector ANN is deferred to a live project. Worker-time delivery tests (kill-switch-after-queue, DNC/consent/takeover/close-after-generation, expiry, knowledge/inventory staleness, duplicate worker, uncertain result, callback replay) are deferred until the real worker is wired — see [`SECURITY.md`](./SECURITY.md) and [`TECH_DEBT.md`](./TECH_DEBT.md).

## Phase 6A (2026-06-20)

Phase 6A adds the deterministic-scoring unit suite and extends the RLS harness. Scoring is advisory / record-only; the tests prove both the calculation correctness and the advisory boundary.

**New unit suite** (`packages/domain/src/__tests__/scoring.test.ts`) covers:

- **Determinism** — identical `{ modelVersion, observations, calculatedAt }` always yield an identical `LeadScoreResult`.
- **Ordering** — rules evaluate by priority then id; component/explanation order is stable.
- **Classification** — hot/warm/cold/disqualified/unscored/review_required at the tenant thresholds; `validateThresholds` ordering.
- **Missing-data safety** — an unknown signal contributes zero, reduces evidence completeness, and never disqualifies; `not_applicable`/`stale`/`unverified` handled.
- **Caps / bounds** — group caps and minimums, total bounds, and the 0–100 scale clamp.
- **Disqualification** — a `disqualify` match short-circuits positive scoring; contradictory critical facts force review.
- **Fairness / prohibited rejection** — `assertNoProhibitedSignals` throws on a prohibited rule; `calculateLeadScore` drops an injected prohibited observation.
- **Overrides + expiry** — `effectiveScore` overlays an active override, ignores an expired one, and preserves the calculated values.
- **Separation** — evidence completeness and calculation confidence are tracked independently of the numeric score.

**RLS harness — the 9 new Phase-6A assertions:** RLS on all 14 scoring tables; a seeded active model exists per tenant; a prohibited signal is rejected on `scoring_rules`; a prohibited signal is rejected on `scoring_signal_definitions`; active-version immutability (rule edits on an active version blocked); exactly one active version per model; a score run records the model version **and** leaves the lead's stage/status unchanged; the recorded model version is never null; cross-tenant isolation on the scoring tables.

**Totals:** the embedded-Postgres harness totals **284 passed / 0 failed** (migrations 0001–0021), including these 9 assertions. The domain unit total includes the new `scoring.test.ts` suite. Exact gate figures are confirmed by the parent agent's final verification run (see [`PHASE_6A_AUDIT.md`](./PHASE_6A_AUDIT.md)).

## Phase 6B (2026-06-20)

Phase 6B adds the deterministic-matching unit suites and extends the RLS harness. Matching is advisory / record-only; the tests prove both the calculation correctness and the advisory boundary.

**New unit suites** (`packages/domain/src/__tests__/matching.test.ts` and `matching-eval.test.ts`) cover:

- **Determinism** — identical `{ modelVersion, leadSnapshot, candidates, calculatedAt }` always yield an identical result.
- **Ranking / tie-break** — eligible candidates first, then by score descending, with a stable tie-break by `candidateId`; ineligible candidates (score 0) follow.
- **Eligibility** — the 7 eligibility gates run before ranking; an ineligible candidate is scored 0 and ranked last.
- **Hard vs soft** — a failed hard rule renders a candidate ineligible; a missed soft rule simply does not contribute.
- **Inventory safety** — verified / stale / not-available states; a unit is confirmed only when `verified_available`; stale inventory leaves a project-level recommendation but never a confirmed unit.
- **Budget outcomes** — within / near / above_preferred / above_absolute / unknown / requires_verification; no invented charges.
- **Missing data** — unknown values do not penalise; preference completeness is reduced; `insufficient_information` where appropriate.
- **Fairness / prohibited drop** — `assertNoProhibitedMatchInputs` rejects a prohibited rule/input; `calculateProjectMatches` drops an injected prohibited input.
- **Separation** — match confidence and preference completeness tracked independently of the numeric score.
- **Evaluation dataset** — location, excluded-location, amenity, budget, no-fresh-inventory, no-units, multiple-equal, and cross-tenant cases run through `matching-eval.test.ts`.

**RLS harness — the 9 new Phase-6B assertions:** RLS on all 14 matching tables; a seeded active model exists per tenant; a prohibited input is rejected on `matching_rules` (the DB CHECK on `signal_key` and `candidate_field`); active-version immutability (rule edits on an active version blocked); exactly one active version per model; a match run records the model version **and** leaves the lead's stage/status unchanged; the recorded model version is never null; parameterized cross-tenant SELECT isolation across all 14 tables; cross-tenant INSERT denial.

**Totals:** the embedded-Postgres harness totals **296 passed / 0 failed** (migrations 0001–0022), including these 9 assertions. The domain unit total includes the new `matching.test.ts` and `matching-eval.test.ts` suites. Exact gate figures are confirmed by the parent agent's final verification run (see [`PHASE_6B_AUDIT.md`](./PHASE_6B_AUDIT.md)).

## Phase 7A — external integration foundation

Phase 7A is tested entirely against **synthetic fixtures** with **no external IO**
(nothing connects to a live provider or sends anything). The frozen safety
switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
outbox, automatic customer sending impossible).

**Domain unit suite** (`packages/domain/src/__tests__/integrations.test.ts`, **19**
cases) covers: idempotency (new / duplicate_ignore on same key+hash /
conflict_reject on same key+different hash); the webhook gate's reject reasons
(wrong method / missing + invalid signature via constant-time compare / expired
timestamp / oversized payload / wrong content-type / unknown + disabled
integration) and tenant-from-endpoint resolution; WhatsApp normalization (text /
media-as-provider-reference / unsupported-safe); WhatsApp policy ordering
(unknown / provider-unavailable / DNC / consent short-circuit before allowed);
forward-only delivery callbacks (ignore regress + duplicate; allow terminal
failed/cancelled); email helpers + the never-invent portal parser (routes to
review on missing contact); health (never healthy on config alone); failure
classification; replay decisions; and the mock / failure / malformed / duplicate /
out-of-order adapters.

**RLS harness — the 11 new Phase-7A assertions:** RLS on all 33 integration
tables; the seeded `manual_test` connection is never `connected`; the
no-`connected` CHECK rejects a `connected` status; no plaintext secret column on
the credentials-metadata table; external-event idempotency uniqueness
(`UNIQUE (tenant_id, idempotency_key)`); a human outbound simulation cannot be
non-simulated (`CHECK simulated = true`); AI send is still impossible
(`send_candidate_status` has no `delivered`/`sent`); parameterized cross-tenant
SELECT isolation across all integration tables; cross-tenant INSERT denial; the
marketing role cannot read `external_events`.

**Totals:** the embedded-Postgres harness totals **317 passed / 0 failed**
(migrations 0001–0024), including these 11 assertions. The domain unit total is
**318**. Exact gate figures are confirmed by the parent agent's final verification
run (see [`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md)).
