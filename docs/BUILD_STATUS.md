# Build Status

Living record of build progress. Updated at the end of every phase (and at meaningful checkpoints). See [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full plan.

---

## Current state

|                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active phase** | Phase 10 — Hardening (complete, local). Phases 0–10 are all locally complete & verified.                                                                                                                                                                                                                                                                                                                                                          |
| **Status**       | Phases 0–10 — Locally Complete & Verified / Controlled-MVP Production — NO-GO Pending Hosted Staging / Phase 7B Live Providers — Not Activated (go-live prep landed) / Phase 5B.1 Live-Send — Not Activated (master switch frozen) / Automatic Customer Sending — Impossible                                                                                                                                                                      |
| **Date**         | 2026-06-22                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Next phase**   | Hosted-staging verification (provisioning, backup/restore drill, hosted RLS, browser smoke, observability, perf baseline) — see [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md). Then, when chosen and approved, the external go-live paths: [`PHASE_7B_GO_LIVE.md`](./PHASE_7B_GO_LIVE.md) and [`PHASE_5B1_GO_LIVE.md`](./PHASE_5B1_GO_LIVE.md). §35 mapping in [`DEFINITION_OF_DONE.md`](./DEFINITION_OF_DONE.md). |
| **Gates**        | format ✅ · lint 0-err ✅ · typecheck ✅ · **413 unit** ✅ · **56 web-server** ✅ · **RLS harness 349/349** ✅ + **pg-phase8 9/9** + **pg-phase9 6/6** + **pg-demo-seed 14/14** ✅ · migrations 0001–0030 ✅ · secret-scan (expanded) ✅ · no-external-IO static+runtime ✅ · e2e compile ✅                                                                                                                                                                               |

**Demo generator (test fixtures) — Phase 8 & 9 (2026-06-22):** the staging-only demo
seeder (`scripts/demo/`) now also seeds Phase 8/9 fixtures for hosted browser testing,
using the canonical schemas + safety CHECKs (no parallel business logic): 2 automations
(5 actions) + 3 runs (1 suppressed customer-send, `will_send=false`), 2 follow-up
sequences + 3 enrollments (active / stopped-DNC / stopped-human) + 6 externally-suppressed
step events, 5 site visits (all states) with a deterministic double-booking rejection case,
1 simulation-only calendar connection + 3 busy blocks, 8 notifications (external deliveries
simulated) + prefs; and Phase 9: 6 usage counters (metered below/near/at growth-tier limits),
1 synthetic billing period (no payment-provider record), 8 system-health checks (6 tenant +
2 platform), 2 logged exports. Fully idempotent + ledger-reversible (reset removes only
generated rows; unrelated control data survives). `demo:status` now reports Phase 8/9 counts.
Verified by `pg-demo-seed` (14/14) plus all gates above. No safety switch touched; no
external IO; no live provider connection; no customer message generated.

**Controlled-MVP deployment readiness:** see [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md). All locally-verifiable gates pass and production env-validation now fails startup on incomplete prod config; the go/no-go decision is **NO-GO — pending hosted staging** (provisioning, backup/restore drill, hosted RLS, end-to-end browser smoke, observability, performance baseline cannot be executed in this build environment). "Production Controlled MVP Approved" is withheld until staging verification passes with a named approver. A repeatable **hosted-staging execution pack** is now in the repo: [`HOSTED_STAGING_RUNBOOK.md`](./HOSTED_STAGING_RUNBOOK.md), [`ENVIRONMENT_MATRIX.md`](./ENVIRONMENT_MATRIX.md), [`HOSTED_RLS_VERIFICATION.md`](./HOSTED_RLS_VERIFICATION.md), [`CONTROLLED_MVP_SMOKE_TEST.md`](./CONTROLLED_MVP_SMOKE_TEST.md), [`BACKUP_RESTORE_DRILL.md`](./BACKUP_RESTORE_DRILL.md), [`PERFORMANCE_BASELINE.md`](./PERFORMANCE_BASELINE.md), staging-safe scripts (`db:staging:preflight`, `db:production:preflight`, `hosted:rls`, `perf:baseline`), a `/api/health` endpoint, log-redaction helpers, and a compilable Playwright skeleton (`test:e2e:compile`).

## Phase tracker

| Phase | Title                                                                            | Status                                                                                                         |
| ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0     | Architecture & documentation                                                     | ✅ Complete                                                                                                    |
| 1     | Foundation (repo, app, design system, auth, tenancy, RLS, shell)                 | ✅ Complete                                                                                                    |
| 1.1   | Foundation Hardening (audit logging, full RLS tests, states, mobile nav, CI)     | ✅ Complete                                                                                                    |
| 2     | Projects & inventory                                                             | ✅ Complete                                                                                                    |
| 3     | Lead CRM (ingestion, dedupe, pipeline, assignment)                               | ✅ Complete                                                                                                    |
| 3.1   | CRM Conversation Readiness (idempotency, durable jobs, calls, qual, exports)     | ✅ Complete                                                                                                    |
| 4     | Conversations (inbox, widget, takeover, summaries, consent/DNC)                  | ✅ Complete                                                                                                    |
| 4.1   | AI Safety & Inbox Completion (guard, lifecycle, history, notes, consent)         | ✅ Complete (local)                                                                                            |
| 5A    | Knowledge, RAG & AI Safety Foundation (providers, grounding, escalation, eval)   | ✅ Complete (local)                                                                                            |
| 5B.0  | Record-Only Responder (live-send safety core, runtime/outbox schema, activation) | ✅ Complete (local, record-only)                                                                               |
| 5B.1  | Controlled Live-Send Activation                                                  | 🟡 Go-live prep landed (governance + UI; switch OFF); activation requires external approval                    |
| 6A    | Deterministic Lead Scoring (versioned, explainable, advisory)                    | ✅ Core complete (local; approved UI deferral)                                                                 |
| 6B    | Project Matching (deterministic, inventory-aware, advisory)                      | ✅ Complete (local, advisory)                                                                                  |
| 7A    | External Sources & Channel Integration Foundation (mock/simulation/record-only)  | ✅ Locally complete & simulated (controlled MVP)                                                               |
| 7B    | Live Provider Activation                                                         | ⬜ Ready for review; external approval required                                                                |
| 8     | Automations & visits                                                             | ✅ Locally complete & verified (automations, follow-ups, visits, calendar-sim, notifications; no live send)    |
| 9     | Analytics & administration                                                       | ✅ Locally complete & verified (real-data dashboards, usage/billing, team perf, system health, logged exports) |
| 10    | Hardening (RLS sweep, security review, a11y, perf, §35 DoD)                      | ✅ Locally complete & verified (NO-GO pending hosted staging)                                                  |

## Phase 10 — Hardening (2026-06-22, build complete locally)

End-of-build hardening: a full RLS sweep, a consolidated security review, an
accessibility pass, performance notes, monitoring confirmation, deployment-runbook
completion, and the §35 Definition-of-Done mapping (30/30 met locally).

- **Full RLS sweep** — `run.mjs` harness **349/349** across migrations 0001–0030,
  plus `pg-phase8` (9/9) and `pg-phase9` (6/6). The sweep **caught a real
  regression**: migrations 0029/0030 had rewritten `on_tenant_created()` from a
  pre-6A base and dropped the 6A/6B/7A/demo provisioning — fixed in both so new
  tenants are fully provisioned; harness restored to 349/349.
- **Docs**: [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md),
  [`ACCESSIBILITY.md`](./ACCESSIBILITY.md), [`PERFORMANCE.md`](./PERFORMANCE.md),
  [`DEFINITION_OF_DONE.md`](./DEFINITION_OF_DONE.md), [`PHASE_10_AUDIT.md`](./PHASE_10_AUDIT.md).
- **Monitoring**: `/api/health`; production env validator requires `SENTRY_DSN`;
  log-redaction helpers.

**Definition of Done:** all 30 §35 criteria met locally; six are met up to a
documented external stop-condition (AI auto-answer, follow-up delivery, calendar
sync, live cost tracking, backup/restore execution, live deployment) — all gated by
hosted staging / 7B / 5B.1.

**Gates (final):** format ✅ · lint 0-err ✅ · typecheck ✅ · 413 unit ✅ · 56 web ✅ ·
RLS harness 349/349 + pg-phase8 9/9 + pg-phase9 6/6 ✅ · migrations 0001–0030 ✅ ·
secret-scan ✅ · no-external-IO ✅. Safety switches frozen.

## Phase 9 — Analytics & Administration (2026-06-22, real data)

Real-data dashboards/reports, usage/billing tracking, team performance, an admin
system-health view, and a logged-export ledger. Funnel/source/team metrics are
computed **on the fly** from the existing RLS-scoped tables via pure `@re/domain`
reducers — no fabricated numbers; every loader is defensive.

- **Domain** (`packages/domain/src/analytics.ts`, pure): `computeFunnel`,
  `computeSourcePerformance` (costs `null` when spend unknown), `computeTeamPerformance`,
  `computeUsage`/`anyOverLimit`, `rollupHealth` (worst-state). +7 unit tests.
- **Migration 0030** (`analytics_admin.sql`, forward-only): 4 tenant-scoped RLS
  tables — `usage_counters`, `billing_periods` (plan/status/amount CHECKs),
  `system_health_checks` (tenant + platform-null rows), `analytics_export_logs`
  (egress ledger). 2 new perms (`system.health.read`, `analytics.export`), 4 audit
  actions, per-tenant grants. (analytics._/billing._ already exist via 0014.)
- **Server** (`apps/web/src/lib/analytics/`): `queries.ts` (RLS-scoped aggregate
  loaders feeding the reducers), `export-service.ts` (logged + injection-safe CSV),
  `billing-service.ts` (billing.manage-gated upsert).
- **UI**: `/analytics` (KPIs, funnel, sources, Export CSV), `/analytics/team`,
  `/settings/usage` (limits + billing), `/admin/system-health`, `/analytics/export`
  — permission-gated, force-dynamic, mobile, empty/error states. Analytics + Usage
  - System-health added to the nav.
- **Docs**: [`ANALYTICS_AND_ADMIN.md`](./ANALYTICS_AND_ADMIN.md) +
  [`PHASE_9_AUDIT.md`](./PHASE_9_AUDIT.md).

**Gates:** format ✅ · lint 0-err ✅ · typecheck ✅ · **413 unit** ✅ · **56 web** ✅ ·
**pg-phase9 harness 6/6** ✅ (RLS on all 4 tables, CHECKs, cross-tenant isolation,
billing.manage gating) · migrations 0001–0030 ✅ · secret-scan ✅ · no-external-IO ✅.
All four safety switches frozen.

**Deferred (TECH_DEBT):** background usage-metering + billing-close PGMQ workers;
live provider health probes (credentials + IO); time-series/cohort charts; live
AI/WhatsApp cost tracking.

## Phase 8 — Automations & Visits (2026-06-22, no live send)

The explicitly-approved automation phase. Workflow automations, score-aware
follow-up sequences (every stop condition + "why sent" provenance), the site-visit
lifecycle with double-booking prevention, a **simulation-only** calendar, and
notifications. **Automatic customer sending remains impossible** — automation
customer-send actions and follow-up step sends are recorded with
`will_send = false` (DB CHECK forbids `true`); internal mutations
(stage/assignment/task/tag/note/notify/enroll) execute for real.

- **Domain** (`packages/domain/src/{automation,followup,visits,notifications}.ts`,
  pure): `evaluateAutomation` (triggers/condition-groups/12 operators, send actions
  flagged willSend:false); `decideFollowUpStep` (9 stop reasons, quiet-hours defer,
  score-gating, why_sent); visit 8-state machine + `detectDoubleBooking`;
  `routeNotification` + dedupe. +40 unit tests.
- **Migration 0029** (`automations_visits.sql`, forward-only): 16 tenant-scoped RLS
  tables across automations (+runs/run_actions with `will_send=false` CHECK),
  follow-up sequences/steps/enrollments/step_events (`will_send=false` CHECK,
  one-active-enrollment partial unique), site_visits/events/outcomes,
  calendar_connections (status CHECK ≠ connected) + busy_blocks, notifications/
  preferences/deliveries (external must be simulated). Reuses existing
  `sitevisits.*`/`automations.manage` perms + adds `automations.read`/`followups.*`/
  `notifications.*`; 13 audit actions; per-tenant grants.
- **Server** (`apps/web/src/lib/{automations,followups,visits,notifications}/`):
  automation runner (suppresses customer-send, executes internal), follow-up
  tick (suppressed sends + enrollment advance/stop), visit scheduling (double-booking
  rejected) + lifecycle + outcomes, notification routing (external simulated). All
  permission-gated + audited.
- **UI**: `/automations` (+`/[id]`), `/automations/sequences` (+`/[id]`), `/visits`,
  `/notifications`, `/settings/notifications` — mobile-responsive, empty/error
  states, no placeholders; Automations + Visits added to the nav.
- **Docs**: [`AUTOMATIONS_AND_VISITS.md`](./AUTOMATIONS_AND_VISITS.md) +
  [`PHASE_8_AUDIT.md`](./PHASE_8_AUDIT.md).

**Gates:** format ✅ · lint 0-err ✅ · typecheck ✅ · **406 unit** ✅ · **56 web** ✅ ·
**pg-phase8 harness 9/9** ✅ (RLS on all 16 tables, `will_send`/calendar/delivery
CHECKs, cross-tenant isolation, permission gating) · migrations 0001–0029 ✅ ·
secret-scan ✅ · no-external-IO ✅. All four safety switches frozen.

**Deferred (TECH_DEBT):** live Google/Outlook calendar sync; real email/push +
WhatsApp/email follow-up delivery (Phase 7B/5B.1 + credentials); production PGMQ
ticking workers; agent-scoped RLS for visits/automations.

## Phase 5B.1 — Controlled Live-Send Activation: Go-Live Preparation (nothing sends, 2026-06-22)

Safe preparation for an _eventual_ live-send activation, built up to — not across —
the master switch. **No switch was flipped; automatic customer sending remains
impossible.** A two-key model gates it: the operator key (a fully-approved two-person
request + rollout window) and the engineering key `LIVE_SEND_MASTER_SWITCH`
(compile-time `false`).

- **Governance engine** `packages/domain/src/ai-live-activation.ts`:
  `evaluateLiveActivation` returns `liveSendingPermitted = operatorReady &&
masterSwitchOn` → **always false** (proven by `ai-live-activation.test.ts` across all
  192 operator-input combinations); `evaluateApprovalCompleteness` (Product +
  Engineering + Legal, no rejection, requester ≠ approver); `SENDABLE_MODES` /
  `isApplicableMode` so the strongest applicable mode is `live_candidate` (still
  suppressed). Blocker labels for the UI.
- **Activation service** `apps/web/src/lib/responder/activation.ts` drives the
  Phase-5B.0 tables (`responder_channel_settings`, `responder_activation_requests`,
  `responder_activation_approvals`): request → multi-role approval (DB trigger forbids
  requester self-approval) → apply-approved-mode (clamped to a non-sendable mode) →
  kill switch. Permission-gated + audited (`responder.activation.requested/approved`,
  `responder.channel.updated`, `responder.killswitch.activated`).
- **UI** `…/settings/ai/activation` (+ server actions): a prominent "automatic sending
  is OFF (master switch)" banner, per-channel current mode / kill-switch / decision
  cards, the sign-off ledger, and request/approve/apply/kill controls — each gated by
  the relevant `responder.*` permission.
- **Docs** [`PHASE_5B1_GO_LIVE.md`](./PHASE_5B1_GO_LIVE.md): the two-key model,
  stop-conditions, operator pre-activation checklist, a two-person **sign-off ledger**,
  the staged rollout, the kill-switch drill, and per-step verification gates.

**Gates (sandbox copy):** format ✅ · lint 0-err ✅ · typecheck ✅ · **366 unit** ✅
(+ governance engine) · **52 web-server** ✅ (+ activation service) · RLS harness
349/349 (unchanged — no schema/DB change) ✅ · secret-scan ✅ · no-external-IO ✅ ·
build ✅. All four safety switches remain frozen; the `ai_runs` /
`ai_responder_decisions` / `send_candidate_status` CHECKs are untouched.

**Not done (still 5B.1 proper, external/engineering):** the master-switch flip + the
CHECK-widening release PR, an idempotent PGMQ delivery worker, AI provider credentials,
a live delivery channel (Phase 7B), paid AI usage, and legal/product sign-off. None
performed.

## Phase 7B — Go-Live Preparation (no credentials, nothing sends, 2026-06-22)

Safe preparation for an _eventual_ live-provider activation, built entirely up to —
and not across — the stop line. **No provider was connected, no switch was flipped,
nothing sends.** A two-key model makes activation impossible by configuration alone:

- **Operator key** — new server env `INTEGRATION_LIVE_PROVIDERS_ENABLED` (default
  `false`; `liveProviderActivationEnabled()` helper in `packages/config`). The
  production env validator now rejects it being `true` under the `controlled_mvp`
  profile (alongside the existing public-webhooks / live-send / binary-media gates).
- **Engineering key** — `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED` (compile-time `false`)
  in the new pure module `packages/domain/src/integration-activation.ts`.
  `evaluateProviderActivation()` returns `allowed = operationalReady &&
codePathImplemented`; because the engineering key is `false`, `allowed` is **always
  false** — proven by `integration-activation.test.ts` across all 512 operator-input
  combinations. Blockers + human-readable labels are surfaced for the runbook/UI.
- **Registry gate** — `resolveActivationAdapter()` (`apps/web/src/lib/integrations/
registry.ts`) routes every "live" request through the decision and therefore always
  returns the inert real-adapter stub (throws `not_enabled_phase_7a`); the structured
  decision is returned for observability. `activation-gate.web.test.ts` proves the
  registry stays inert even with the flag forced ON and `DEPLOYMENT_PROFILE=full`.
- **Docs** — [`PHASE_7B_GO_LIVE.md`](./PHASE_7B_GO_LIVE.md): the two-key model, the
  stop-conditions, a credential/env **intake matrix**, an operator pre-activation
  checklist, the staged activation sequence, per-step verification gates, and the kill
  switch / rollback. `.env.example` documents the safety gates.

**Gates (executed on the sandbox copy):** format ✅ · lint 0-err ✅ · typecheck ✅ ·
**355 unit** ✅ (+ activation engine + env flag) · **44 web-server** ✅ (+ activation
gate) · embedded-PG ✅ · RLS harness 349/349 (unchanged — no schema/DB change) ✅ ·
secret-scan ✅ · no-external-IO ✅ · build ✅. All four safety switches remain frozen.

**Not done (still Phase 7B proper, external/engineering):** real network adapters,
provider accounts/credentials, webhook-domain verification, provider app review, paid

- compliance approval, live Supabase + PGMQ, and any switch flip. None performed.

## Phase 7A — External Integration Foundation (mock / simulation / record-only, 2026-06-20)

A secure, tenant-isolated, idempotent integration platform for external lead
sources and channels — built entirely against **mock / fixture / record-only**
adapters. Phase 7A performs **no external IO**, connects to no live provider, and
sends nothing. All safety switches are frozen (`LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
outbox); automatic customer sending remains impossible (re-asserted by the harness).

- **Domain core** (`packages/domain/src/integrations.ts`, pure, no IO):
  provider-neutral `ExternalIntegrationAdapter` + the `NormalizedExternalEvent`
  envelope; `payloadHash` + `buildExternalIdempotencyKey` + `decideIdempotency`
  (same-key/same-hash dedupes, same-key/different-hash rejected); webhook security
  (`decideWebhookAcceptance` + `constantTimeEqual` + `withinReplayWindow`, tenant/
  integration resolved from the endpoint never the payload); WhatsApp inbound
  normalization (media as provider-reference-only, `not_scanned`; unsupported →
  safe event) + an 8-state conversation-policy machine; forward-only delivery-
  callback transitions; email quoted-history strip + dangerous-URL + secret
  redaction; deterministic portal parsers (never invent fields → review);
  `computeHealthState` (never healthy on config alone); `classifyFailure` +
  `decideReplay`; mock/failure/malformed/duplicate/out-of-order adapters. 19 unit
  tests (`integrations.test.ts`).
- **Migration 0024** (`integration_foundation.sql`, forward-only): **33** tenant-
  scoped RLS tables across connections (+credentials **metadata only** — no
  plaintext secret column), external events (UNIQUE idempotency), channels,
  WhatsApp, email, source/campaign/form mappings, and human-outbound. A DB CHECK
  forbids `connected` status in 7A; human-outbound simulations CHECK `simulated=
true`. 16 permissions, 24 audit actions, a seeded `manual_test` connection per
  tenant.
- **Server (mock/record-only)** (`apps/web/src/lib/integrations/*` + `app/api/
integrations/[connectionId]/webhook/route.ts`): an adapter registry (real
  adapters are inert stubs that throw `not_enabled_phase_7a`); persist-before-
  process webhook ingestion (server-side HMAC, replay/size/rate gate, DB
  idempotency, normalize, then route through the **existing** lead + conversation
  ingestion services — no parallel pipelines); health compute; human-send
  **simulation** (writes only `human_outbound_*` with `simulated=true`, no provider
  ref, no delivered state); dead-letter + replay.
- **UI** (17 routes, permission-gated, TEST-MODE banners, never shows secrets):
  `/settings/integrations` (+ new/[id]/events/health/mappings/replay),
  `/settings/integrations/whatsapp` (+ [id]/templates/test, **TEST MODE — NO
  WHATSAPP MESSAGE SENT** / **SIMULATION — MESSAGE NOT SENT**),
  `/settings/integrations/email` (+ [id]/rules/test, **TEST MODE — NO MAILBOX
  CONNECTED**), and `/integrations/events` (safe filterable event log).

**Harness evidence (Phase 7A):** all 33 tables RLS-enabled; seeded test connection
is never `connected`; the no-`connected` CHECK; no plaintext secret column;
external-event idempotency uniqueness; a human simulation cannot be non-simulated;
AI send still impossible (`send_candidate_status` has no delivered/sent);
parameterized cross-tenant SELECT isolation across all integration tables;
cross-tenant INSERT denial; a marketing role cannot read `external_events`. Harness
**317/317**.

**Everything live is Phase 7B (blocked):** real provider IO, credentials,
accounts, webhook-domain verification, provider app review, Pub/Sub, IMAP/SMTP,
paid services, compliance/privacy approval, live Supabase, production queues +
monitoring, Storage (binary media stays provider-reference-only). See
`PHASE_7A_AUDIT.md`.

## Phase 6B — Project Matching (advisory, 2026-06-20)

A deterministic, versioned, explainable project/configuration/unit matching
engine. Matching is **advisory**: it never assigns a lead, changes a
stage/status/score, reserves inventory, or sends anything (verified by the
harness). The Phase 5B.1 stop-line is untouched — automatic customer sending
remains impossible.

- **Deterministic engine** (`packages/domain/src/matching.ts`, pure, no IO):
  `calculateProjectMatches` — three **levels** (project / configuration / unit,
  treated distinctly); rule **kinds** hard/soft/informational/review_required; 14
  operators (incl. budget/area/date-window overlap, distance threshold, set
  intersection, required/preferred feature, exclusion, freshness); candidate
  **eligibility** gates run before ranking (cross-tenant, inactive, unapproved,
  not-visible, not-sale, category, excluded → `ineligible`, ranked last);
  classifications Excellent/Good/Possible/Weak/Ineligible/Review/Insufficient;
  six **inventory states** with `unitConfirmedAvailable` true only when
  verified-available (status available + within freshness window + no reservation
  conflict); budget outcomes with **no invented charges**; match confidence AND
  preference completeness tracked **separately** from the score; stable
  deterministic tie-break. **Fairness:** prohibited inputs rejected
  (`assertNoProhibitedMatchInputs`) + dropped on calculate; no demographic/
  neighbourhood profiling; travel time never fabricated. Unit suites
  `matching.test.ts` + `matching-eval.test.ts`.
- **Migration 0022** (`project_matching.sql`, forward-only): 14 tenant-scoped RLS
  tables (models, versions, rule groups, rules, runs, candidates, components,
  inventory snapshots, overrides, feedback, evaluation datasets/cases/runs/
  results). **Active versions immutable** (trigger); **one active per model**
  (partial unique); a match run records the **exact model version** (NOT NULL) +
  preference/qualification/inventory snapshots and never overwrites history.
  **Fairness CHECK** blocks prohibited keys on a rule's signal **and** candidate
  field. 8 permissions, 16 audit actions, synthetic seed model per tenant.
- **Server (advisory)** (`apps/web/src/lib/matching/*`): candidate generation
  from real projects/configs/inventory under the user's RLS (tenant/active/
  approved/visible/sale; unit confirmed only when available+fresh); `runLeadMatch`
  persists run+candidates+components+inventory snapshots, mutates nothing;
  recalculation via the durable-job abstraction; override + feedback services;
  review-only AI preference extraction (never mutates preferences or runs a match).
- **UI**: `/matching/test-lab` (**TEST MODE — NO LEAD, PROJECT OR INVENTORY
  UPDATED**), a lead matching panel (recommendations, classification, confidence,
  preference completeness, inventory state + last verification, budget/location/
  amenity fit, exclusion reasons, history, gated override + feedback + recalc; a
  unit is shown confirmed only when verified), `/settings/matching` (+ `/[id]`
  draft rule editor) with audited lifecycle, and a permission-scoped "potentially
  matching leads" view on `/projects/[id]` (visible leads only; Project Maintenance
  excluded).

**Harness evidence (Phase 6B):** 14 matching tables RLS-enabled; seeded active
model; prohibited signal/candidate-field rejected; active-version immutability;
one active version per model; a match run records the version and **leaves the
lead's stage/status unchanged**; `model_version_id` NOT NULL; parameterized
cross-tenant SELECT isolation across all 14 tables; cross-tenant INSERT denial.
Harness **296/296**.

**Documented deferrals:** automatic assignment/stage/status/score change (a later
explicitly-approved automation phase); inventory reservation/booking (never in
matching); production durable (PGMQ) recalculation; live travel-time/traffic data
(Unknown unless trusted stored facts); the `/settings/matching/evaluation` UI
runner (tables + domain evaluation dataset exist). See `PHASE_6B_AUDIT.md` and
`TECH_DEBT.md`.

## Phase 6A — Deterministic Lead Scoring (advisory, 2026-06-20)

A versioned, explainable, deterministic lead-scoring system that ASSISTS sales
teams. Scoring is **advisory**: nothing changes a lead's stage, assignment,
status, or conversation mode, and nothing triggers communication (verified by the
harness). The Phase 5B.1 external stop-line is untouched — automatic customer
sending remains impossible.

- **Deterministic engine** (`packages/domain/src/scoring.ts`, pure, no IO):
  `calculateLeadScore` — 11 rule operators, 8 rule groups, signal states
  (known/unknown/not_applicable/contradictory/stale/unverified), group caps/
  minimums + total bounds + 0–100 scale, classifications
  Hot/Warm/Cold/Disqualified/Unscored/Review. **Missing data is safe** (zero, not
  negative; never disqualifies). **Evidence completeness + calculation confidence
  are tracked separately from the score** (a high score never implies complete
  qualification). `effectiveScore` overlays a manual override and ignores expired
  overrides while preserving the calculated value. **Fairness:**
  `PROHIBITED_SIGNAL_KEYS` + `assertNoProhibitedSignals`; prohibited observations
  are dropped even if injected. Unit suites `scoring.test.ts` + `scoring-eval.test.ts`
  (determinism, ordering, classification, missing-data, caps, disqualification,
  overrides/expiry, threshold validation, + a 14-case evaluation dataset and
  fairness/forbidden-input assertions).
- **Migration 0021** (`lead_scoring.sql`, forward-only): 14 tables (models,
  versions, rule groups, rules, signal definitions, observations, score runs,
  components, history, overrides, evaluation datasets/cases/runs/results) — all
  tenant-scoped with RLS. **Active versions are immutable** (a trigger blocks rule
  edits on an active version; you draft a new version). **One active version per
  model** (partial unique index). A score run records the **exact model version**
  (NOT NULL) and never overwrites history. **Fairness CHECK** (`is_prohibited_signal`)
  blocks prohibited keys on rules, definitions, and observations. 8 permissions,
  17 audit actions, synthetic seed model per tenant.
- **Server (record-only)** (`apps/web/src/lib/scoring/*`): observation recorder
  (rejects prohibited signals; supersedes, never deletes), `runLeadScore`
  (active model + live observations → calc → persisted run + components + history;
  reads the lead row only, mutates nothing), recalculation via the durable-job
  abstraction (idempotent, local-sync), override apply/remove, and a **review-only**
  AI extraction that proposes `unverified` observations and never mutates a score.
- **UI**: `/scoring/test-lab` (deterministic, **TEST MODE — NO LEAD UPDATED**),
  a lead scoring panel (effective/calculated score, classification, qualification
  completeness, evidence confidence, model version, top signals, missing/
  contradictions, history, gated recalculate + override), `/settings/scoring`
  (+ `/[id]` version detail + draft rule editor, `/signals`) with audited model
  lifecycle (create/clone/submit/approve/activate/retire), and lead-list
  score/classification filters + opt-in score sort.

**Harness evidence (Phase 6A):** 14 scoring tables RLS-enabled; seeded active
model; prohibited signal rejected on rules **and** definitions; active-version
rules immutable; at most one active version; a score run records the model version
and **leaves the lead's stage/status unchanged**; `model_version_id` is NOT NULL;
tenant B cannot read tenant A scoring models. Harness **284/284**.

**Documented deferrals:** project matching (Phase 6B); any automatic
stage/assignment/status change (a later, explicitly-approved automation phase);
production durable (PGMQ) recalculation; the `/settings/scoring/evaluation` UI
runner (the evaluation tables + the domain evaluation suite exist). See
`PHASE_6A_AUDIT.md` and `TECH_DEBT.md`.

## Phase 5B.0 — Production-readiness hardening (record-only, 2026-06-20)

Prepares (but does not activate) the infrastructure for a future, separately
reviewed Phase 5B.1 live-send PR. **Automatic customer sending is impossible** —
`RESPONDER_LIVE_SENDING` and the new global `LIVE_SEND_MASTER_SWITCH` are both
compile-time `false`, the `ai_runs (mode<>'automatic')` and
`ai_responder_decisions (outcome<>'deliver')` CHECKs are **unchanged**, and the
new outbox enum has no `delivered`/`sent` value, so a customer send is not even
storable.

- **Live-send safety core** (`packages/domain/src/ai-live-send.ts`, pure +
  tested): `LIVE_SEND_MASTER_SWITCH=false` (global, distinct from any DB flag);
  `evaluateLiveSendGates` (15 layered gates, master ANDed with the constant so
  every DB flag on still yields `allowed:false`); `buildAutomaticSendIdempotencyKey`;
  `shouldCancelStaleCandidate`; `revalidateAutomaticSend` (worker-time recheck,
  never proceeds); a provider-neutral `OutboundDeliveryTransport` with four
  **simulation** transports (dry-run / failure / timeout / success-sim — none
  perform IO); `reconcileUncertainAttempt` (never resends an uncertain accepted
  message). 18 new unit tests.
- **Migration 0020** (`responder_runtime_outbox.sql`, forward-only): runtime
  enablement (`responder_channel_settings`, modes disabled/shadow/copilot/
  live_candidate — **no active `live`**; caps, languages, categories, rollout,
  effective windows, kill switch); two-person activation
  (`responder_activation_requests` + `responder_activation_approvals`, unique
  per approver + a trigger forbidding self-approval); the transactional outbox
  (`ai_send_candidates` with a unique idempotency key and a status enum that has
  **no delivered/sent**; `ai_send_attempts` for reconciliation). RLS on all five;
  four new permissions; six audit actions.
- **Readiness docs:** `PHASE_5B_READINESS.md` (central; implemented vs simulated
  vs external vs impossible), `AI_LIVE_SEND_POLICY.md`, `AI_ROLLOUT_PLAN.md`,
  `AI_DELIVERY_LIFECYCLE.md`, `AI_KILL_SWITCH.md`, `AI_PROVIDER_PRIVACY.md`,
  `AI_OBSERVABILITY.md`; plus updates to `DEPLOYMENT.md` (non-destructive prod
  sequence + env separation + ANN gate), `SECURITY.md`, `TEST_PLAN.md`,
  `TECH_DEBT.md`.

**Harness evidence (Phase 5B.0):** `responder_runtime_mode` has no `live`;
`send_candidate_status` has no `delivered`/`sent`; the five new tables have RLS;
a candidate cannot be marked delivered; the idempotency key is unique; a simulated
candidate creates no customer message; a requester cannot approve their own
request; tenant B cannot read tenant A candidates. Harness **275/275**.

## Phase 5B — progress (Customer-facing AI answering, behind the safety boundary, 2026-06-20)

**Increment 1 — the responder exists but cannot send.** The automatic-responder
decision + pipeline are built and exercised end-to-end, while delivery to a real
customer is made impossible by construction:

- **`packages/domain/src/ai-responder.ts`** — pure `decideResponderOutcome` runs
  the full send-gate sequence (operating-mode = AI, human-takeover, lifecycle
  open, DNC, consent, tenant/project AI enablement, channel policy, provider,
  daily limit, model configured, knowledge approved, grounding = grounded,
  candidate present) → `blocked | escalate | suppressed | deliver`. A
  compile-time `RESPONDER_LIVE_SENDING = false` downgrades the only otherwise-
  deliverable path to **`suppressed`** with reason
  `phase_5b_automatic_responder_not_enabled`; `delivered` is the literal `false`.
  Unit tests prove **no input** makes it deliver.
- **`supabase/migrations/0019_ai_responder.sql`** — `ai_responder_decisions`
  (tenant/conversation/lead/project/run, outcome, reason, candidate_body, gates,
  correlation) with per-command RLS. A DB **CHECK forbids the `deliver` outcome**,
  so a forged insert cannot record (or imply) an automatic send.
- **`apps/web/src/lib/ai/responder.ts`** (`server-only`) — `runResponder` runs the
  orchestrator in **shadow** mode (mock provider), records the (non-sent) decision,
  and on escalate/blocked writes an internal `ai_escalation_decisions` row. It
  **never** inserts a `conversation_message`, delivery event, or changes
  waiting-on/unread/status/`ai_active`. Reachable via the permission-gated
  `runResponderAction` (`ai.shadow.manage`).

**Increment 2 — auto-trigger on inbound + agent review surface (no live send).**

- **Inbound auto-trigger** (`apps/web/src/app/api/chat/[widgetId]/message/route.ts`)
  — after a customer message is durably persisted, an **AI-mode** conversation
  (`operating_mode = 'ai'`) fires `runResponder` to record a decision. It is wrapped
  so a responder failure can never break the inbound ack, and (by construction)
  never sends.
- **Review surface** (`/ai/responder`, nav-linked, permission `ai.runs.read`) — lists
  recent `ai_responder_decisions` (outcome chip, reason, would-be-reply preview
  clearly labelled "not sent", conversation deep-link) with empty/error states and a
  responsive layout.

**Increment 3 — per-conversation panel + review filtering/metrics (no live send).**

- **Inbox panel** (`apps/web/src/app/(app)/inbox/[id]/responder-panel.tsx`, gated by
  `ai.runs.read`) — shows the latest decisions for the open conversation and a
  permission-gated (`ai.shadow.manage`) **"Run responder (no send)"** button that
  records a fresh decision and refreshes; the panel states plainly that nothing is
  sent.
- **Review filtering + metrics** (`/ai/responder`) — per-outcome counts
  (All / Suppressed / Escalate / Blocked) as filter chips driven by an `?outcome=`
  query param.

**Increment 4 — responder safety evaluation harness (no live send).** A pure
`summarizeResponderRun(decisions)` aggregates outcome counts with a headline
`safe` flag (`delivered === 0`). `ai-responder-eval.test.ts` enumerates a broad
matrix (operating-mode × grounding, every boolean send-gate flipped, no-candidate)
and asserts across **all** scenarios: nothing is ever delivered; grounded+open →
suppressed; not-grounded → escalate; any failed gate → blocked; and that the
summary flags an (impossible) delivered decision as unsafe.

**Harness evidence:** `ai_responder_decisions` exists with RLS; a `deliver`
outcome is rejected by CHECK; a suppressed decision is recorded with its candidate
retained; **no** AI `conversation_message` is created; tenant B cannot read tenant
A's decisions.

**Still gated (the documented stop-line):** turning on live sending
(`RESPONDER_LIVE_SENDING`), real server-only provider credentials, paid-service
approval, and the pgvector ANN path on a live project. These require explicit
go-ahead + credentials and are not crossed autonomously. The exact sequence of
gates, code/schema changes, rollout/kill-switch and sign-offs needed to flip the
responder live is documented in
[`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md).

## Phase 5A — completion report (Knowledge, RAG & AI Safety Foundation, 2026-06-20)

**What was completed:** A tenant-isolated, project-aware knowledge + AI
foundation with NO customer-facing AI answering. The central execution boundary
(`evaluateAiExecution`) makes automatic customer sending impossible
(`maySendAutomatically: false`; automatic → `phase_5b_automatic_responder_not_enabled`;
`ai_runs` CHECK `mode <> 'automatic'`). Knowledge lifecycle + versioning +
approval; provider-neutral chat/embedding abstractions (mock default, server-only
credentials); deterministic chunking; **in-database** hybrid retrieval (FTS +
vector similarity computed in SQL via `match_knowledge_chunks`, filtered by
embedding-model config + matching dimensions under RLS); read-only allow-listed
dynamic project tools with freshness/stale flags; deterministic grounding +
conflict + escalation; preserved customer-safe citations; prompt-injection +
SSRF defence; multilingual routing; usage limits; AI run tracing with no hidden
reasoning; the `/ai/test-lab` (TEST MODE — NOT SENT), shadow + copilot drafts;
and a synthetic evaluation dataset + scorer.

**Migrations:** `0017_knowledge_ai_foundation.sql` (~38 tables + RLS + permissions

- audit actions + provisioning), `0018_embedding_pgvector.sql` (canonical
  in-database similarity + pgvector production path + embedding provenance).

**Audit & remediation (2026-06-20):** an evidence-based audit
(`docs/PHASE_5A_AUDIT.md`) fixed (a) BUILD_STATUS contradictions + a stale Phase
4.1 "in progress" heading, (b) canonical embedding storage — moved from
application-side jsonb-array cosine to in-database similarity with model/dimension
filtering — and (c) a discovered FAQ-chunk-splitting bug.

**Gates:** format ✅ · lint 0-err ✅ · typecheck ✅ · **201 unit** ✅ · embedded-PG
harness **262/262** (migrations 0001–0018, incl. per-table RLS for all new tables

- DB-side similarity/isolation) ✅ · migration-order (18) ✅ · secret scan ✅ ·
  production build ✅.

**Deferred:** live Supabase / pgTAP + the pgvector `<=>` ANN path (embedded-PG has
no pgvector); external provider adapters (server-only stubs until credentials).

**Status:** Phase 5A — Locally Complete and Verified. Phase 5B — Ready for Review
(NOT started). Live Supabase + Production Verification — Deferred/Pending.

## Phase 0 — completion report

**What was completed:** Inspected the (empty) repository; persisted the authoritative spec; produced the full Phase-0 documentation set with a Mermaid architecture diagram and ERD, a permissions matrix, page map, API map, milestones, risk register, recorded assumptions; identified and resolved spec contradictions.

**Files created:**

- `docs/MASTER_SPEC.md` (authoritative spec, committed)
- `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/PERMISSIONS_MATRIX.md`
- `docs/AI_SYSTEM.md`, `docs/SCORING_ENGINE.md`, `docs/INTEGRATIONS.md`, `docs/UI_SYSTEM.md`
- `docs/PAGE_MAP.md`, `docs/API_MAP.md`, `docs/TEST_PLAN.md`, `docs/DEPLOYMENT.md`
- `docs/CONTRADICTIONS.md`, `docs/ASSUMPTIONS.md`, `docs/RISKS.md`, `docs/IMPLEMENTATION_PLAN.md`
- `docs/BUILD_STATUS.md` (this file)
- `CLAUDE.md`, `README.md`

**Migrations added:** none (docs-only phase).

**Tests run:** none (no code yet). Diagram validity and cross-doc consistency verified in the Phase-0 verification step.

**Remaining work:** Begin Phase 1 (repository scaffold + foundation). Pin exact library versions in the Phase-1 lockfile.

**Risks / blockers:** No Phase-0 blockers. Build stop-conditions for later phases (external credentials, irreversible production actions, paid-service commitments, legally sensitive decisions) are catalogued in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4 and [`RISKS.md`](./RISKS.md).

## Phase 1 — completion report

**What was completed:** Scaffolded the pnpm workspace and tooling; built the deterministic core packages with tests; authored the Supabase tenancy/identity/roles/permissions schema with default-deny RLS, helper functions, a tenant-provisioning trigger, synthetic seed and a pgTAP RLS suite; and built a working Next.js App Router shell with Supabase auth, tenant-resolution middleware, white-label branding, a permission-gated nav, and real data-backed Dashboard/Team/Settings pages.

**Files created (high level):**

- Workspace: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (exact pins), `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.nvmrc`, `.env.example`, `vitest.config.ts`.
- `packages/config` — Zod env validation (client vs server split) + feature flags/plan limits.
- `packages/validation` — permission-key catalog, default role bundles, tenant/E.164 schemas.
- `packages/domain` — deterministic RBAC (effective-permission resolution, scope implication, `canReadLead`) + **13 Vitest unit tests**.
- `packages/ui` — design tokens (light/dark), `tokens.css`, `cn()`.
- `apps/web` — Next.js app: Supabase server/browser/admin clients, middleware, `getAppContext`, sign-in + sign-out actions, app shell (sidebar/topbar/tenant switch), Dashboard/Team/Settings, state primitives, Tailwind wired to tokens.
- `supabase/` — `config.toml`; migrations `0001`–`0004` (extensions, identity/tenancy, auth-context helpers + permission seed, role seeding + RLS); `seed/seed.sql` (synthetic); `tests/0001_rls_tenant_isolation_test.sql` (pgTAP).

**Migrations added:** `0001_extensions`, `0002_identity_tenancy`, `0003_auth_context`, `0004_roles_seed_and_rls`.

**Tests run (in sandbox):**

- ✅ Unit (Vitest): 13/13 passing (RBAC + default-role isolation incl. "maintenance cannot read private conversations", "agent assigned-only", "viewer read-only", "super-admin no tenant data").
- ✅ Typecheck (tsc strict): all packages + `@re/web` clean.
- ✅ Lint (ESLint) clean; ✅ Prettier formatting clean.
- ✅ `next build`: optimized production build succeeds (8 routes, middleware bundled).
- ⏳ **Database tests (pgTAP) and `supabase db reset` not run in this environment** — the sandbox has no Docker/Postgres. The migrations, RLS policies, seed and pgTAP suite are authored and inspection-reviewed; run `supabase db reset` then `supabase test db` on a Docker-capable machine to execute them.

**Remaining work / notes:**

- Run the Supabase stack locally (`supabase start` + `supabase db reset`) to execute migrations, seed, and pgTAP RLS tests, then wire CI (GitHub Actions) — carried into Phase 2's CI setup.
- Navigation currently exposes only the live Phase-1 pages (Dashboard, Team, Settings); later phases append their pages as they become functional (no placeholders — docs/CONTRADICTIONS.md C13).
- Environment limitation: the connected folder's mount blocks `unlink`, so `node_modules` cannot be installed into it; install/build/test were verified on a sandbox-local copy. Developers run `pnpm install` normally on their own machine.

**Risks / blockers:** No product blockers. Going live with WhatsApp/Gmail/AI providers remains a later-phase stop-condition (credentials).

## Phase 1 audit (2026-06-19)

A full Phase 1 verification was performed; full report in [`PHASE_1_AUDIT.md`](./PHASE_1_AUDIT.md). Executed results:

- **Clean install** (`pnpm install --frozen-lockfile`) reproducible; **format:check**, **lint**, **typecheck** (all 5 projects), **unit tests** (13/13), **production build** (8 routes) — all green.
- **App start + protected routes** verified at runtime: `/sign-in` → 200; `/dashboard`,`/team`,`/settings`,`/` → 307 → `/sign-in` when unauthenticated.
- **RLS / tenant isolation** verified against a real (embedded) Postgres with the migrations applied from a clean DB + seed: **17/17** assertions (cross-tenant SELECT/INSERT/UPDATE/DELETE all blocked). Official `supabase test db` (pgTAP) still to run on a Docker-capable machine.
- **Secrets:** service-role key absent from client bundles; auth is Supabase-backed (not mocked); no hardcoded users/tenant IDs/creds in source.

**Defects found & fixed during the audit:** (F1, High) env validation passed the whole `process.env` object, breaking `NEXT_PUBLIC_*` inlining in the Edge middleware and causing **HTTP 500 on every route** — fixed in `packages/config/src/env.ts` (literal property references) and re-verified. (F2) `format:check` failing — fixed via `.prettierignore` + `prettier --write`.

**Open debt (non-blocking for Phase 2):** application-level audit logging (`audit_logs`/`security_events`) — implement before impersonation/role-edit; `loading.tsx`/`error.tsx` route boundaries; mobile bottom navigation; ESLint Next plugin; official pgTAP run; GitHub Actions CI.

**Phase 2 readiness: GO** (not started — held for review per instruction).

## Phase 1.1 — Foundation Hardening (2026-06-19)

Remediation milestone (no Projects/Inventory). Full report: [`PHASE_1_1_AUDIT.md`](./PHASE_1_1_AUDIT.md).

- **Audit logging** built end-to-end: migration `0005` (`audit_logs` append-only, `security_events`, enums, `audit_actions` catalogue, indexes, RLS, `audit_retention_days`); typed catalogue in `@re/validation` with secret redaction; server write/query services; `/audit` admin page with filters + event-detail drawer. Events wired: sign-in success/failure, sign-out, tenant-switch(+denied), branding/org update, invitation create.
- **RLS completed:** explicit tests for **all 12** Phase-1 tenant tables + scenarios. Local harness on real embedded Postgres: **56/56**. Official pgTAP authored (`0002`, 51 assertions).
- **Security fix:** removed platform-admin **silent** tenant-data access from RLS (branding/settings/features/roles/memberships/audit) — platform admin now sees only the tenants registry + platform-scope audit. ([`SECURITY.md`](./SECURITY.md) §12a.)
- **Route states:** `loading.tsx` / `error.tsx` / `not-found.tsx` + reusable Loading/Skeleton/Empty/Error/PermissionDenied/Retry/Offline.
- **Mobile bottom nav** (Today/Inbox/Leads/Visits/More), safe-area + a11y + permission/flag-aware; unbuilt areas route to a clear coming-soon state.
- **ESLint** Next plugin wired (root + app config); `pnpm lint`/`pnpm build` warning gone, no Next rule disabled.
- **CI** (`.github/workflows/ci.yml`): quality + official Supabase (db reset + pgTAP) + a final gate that **stays red until the official Supabase result is recorded** in `supabase/.official-verification.json`.
- **Gates (executed):** format ✔ · lint ✔ · typecheck (5) ✔ · unit 19/19 ✔ · build (9 routes) ✔ · migration order ✔ · secret scan ✔ · RLS harness 56/56 ✔ · official-supabase gate **fails by design** (blocked: no Docker here).
- **Blocker (gated):** official `supabase db reset` + `supabase test db` must be run on a Docker machine and recorded. Exact command in [`DEPLOYMENT.md`](./DEPLOYMENT.md) §11a.

## Phase 2 — Projects & Inventory (2026-06-19, core)

**Delivered & verified:**

- **Schema** (`0006_projects_inventory.sql`): `projects` (+ approval workflow), `project_configurations`, `project_amenities`, `project_offers`, `towers_or_blocks`, `floors`, `inventory_units` (7 statuses + `last_verified_at` freshness), append-only `inventory_status_events` + `inventory_price_history` (SECURITY DEFINER trigger), `inventory_imports` + `inventory_import_rows`. RLS read/manage/import; new audit actions seeded; synthetic seed (a project + configs + units).
- **Domain (unit-tested):** `isOfferable` (only `available` is offerable), `isStale`, `summarizeAvailability` (offerable = available **and** fresh), and CSV/XLSX import row mapping + validation (`mapAndValidateRow`/`mapRows`). Validation schemas for project/unit/import.
- **App:** `/projects` (list + create), `/projects/[id]` (detail, configurations, availability summary, add unit, inline status change with history, approve), `/inventory` (cross-project table + availability KPIs + stale-data report + re-verify), `/inventory/import` (CSV paste → auto-map → column-mapping wizard → import with per-row errors). Audit events wired: project create/approve, inventory update/status-change/import, staledata.resolve.
- **Invariant enforced:** matching/availability reads only real `available` units, and stale availability is flagged for re-verification (MASTER_SPEC §10).

**Verification (executed):** lint ✔ · typecheck (5) ✔ · unit tests **26/26** ✔ · build ✔ (13 routes incl. `/projects`, `/projects/[id]`, `/inventory`, `/inventory/import`) · migration order (6) ✔ · secret scan ✔ · **RLS harness 75/75** (56 Phase 1 + 19 Phase 2; migrations 0001–0006 from clean DB + seed). Official pgTAP added (`0003_projects_inventory_rls_test.sql`).

**Phase 2 remainder — now delivered (2026-06-19):**

- **Migration `0007`**: `project_faqs`, `project_media`, `project_documents` (+ RLS).
- **Project editor** (`/projects/[id]/edit`): edit project fields + full CRUD for configurations, amenities, offers, FAQs, and documents/media (by URL). Server/client boundary handled with bound server actions. Audit `project.update`.
- **Bulk inventory editor**: multi-select units on `/inventory` and apply a status in one action (`inventory.manage`), audited.
- **XLSX import**: the importer now accepts a `.csv` or `.xlsx` **file upload** (parsed client-side via SheetJS, dynamically imported) as well as pasted CSV; rows are submitted as JSON through one server path with per-row error reporting.
- **Verification:** lint ✔ · typecheck (5) ✔ · unit 26/26 ✔ · build ✔ (15 routes incl. `/projects/[id]/edit`) · migration order (7) ✔ · secret scan ✔ · **RLS harness 81/81** (migrations 0001–0007 from clean DB + seed).

**Only deferred item:** direct binary upload of media/brochures to Supabase Storage (currently referenced by URL); to be wired when Storage buckets are provisioned.

**Blocker (unchanged):** official `supabase db reset` + `supabase test db` still must be run + recorded ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §11a); the gate remains red by design.

## Phase 3 — Lead CRM (2026-06-19, core)

**Delivered & verified:**

- **Schema** (`0008_leads_pipeline.sql`): full leads domain — leads, contacts, preferences, sources, source events, attribution, a default 12-stage pipeline seeded per tenant, assignments (one active/lead), notes, tags, stage history, activity, duplicates + reversible resolution events, tasks, lost reasons. **Assignment-scoped RLS** (agents see only assigned leads; child tables inherit parent visibility); `current_user_assigned()` SECURITY DEFINER breaks the leads↔assignments policy recursion.
- **Deterministic domain (unit-tested)**: phone E.164 normalization, multi-signal duplicate detection with exact/probable/possible confidence (never name-only), and the assignment engine (eligibility, language/project/workload filters, weighted round-robin, **manual assignment never overwritten**). +20 tests.
- **Ingestion pipeline** (`lib/leads/ingest.ts`): normalize → dedupe (flagged for review, never silent-merge) → create + source event + first/last attribution → auto-assign → audit. Reused by **manual entry, CSV import, and the public `/forms/:tenant` endpoint** (≥3 sources, per the exit criteria).
- **App**: `/leads` (list + filters + create + CSV), `/leads/[id]` (identity, status, stage mover, assignment, source, notes, stage history, duplicate flags), `/leads/duplicates` (review queue with reversible **merge**/dismiss), `/pipeline` (Kanban by stage). Audit wired: `lead.create`, `lead.assign`, `lead.stage_change`, `lead.note.add`, `lead.merge`, `lead.dedupe.dismiss`.

**Verification (executed):** lint ✔ · typecheck (5) ✔ · unit **46/46** ✔ · build ✔ (20 routes incl. `/leads`, `/leads/[id]`, `/leads/duplicates`, `/pipeline`, `/forms/[tenant]`) · migration order (8) ✔ · secret scan ✔ · **RLS harness 95/95** (migrations 0001–0008 from clean DB + seed; agent assigned-scope, cross-tenant, child-table inheritance, merge permission all asserted).

**Phase 3 remainder — now delivered (2026-06-19):**

- **Tasks**: `/tasks` (my/team/overdue) + create/complete actions + a Tasks panel on lead detail (audited `task.create`).
- **Lead bulk + export**: multi-select **bulk stage move** on `/leads`, and an RLS-scoped **CSV export** route (`/leads/export`, `leads.export`, audited as a data egress).
- **Broker/direct overlap** (migration `0009`): ingestion flags duplicates where the matched lead came from the opposite source side (third-party portal/ad vs direct); the duplicate-review UI shows a "broker conflict" badge and captures **source precedence + estimated commission exposure** on merge. Ownership is never auto-decided. A `broker_overlap_metrics` view retains the per-tenant count.

**Verification:** lint ✔ · typecheck (5) ✔ · unit 46/46 ✔ · build ✔ (20+ routes incl. `/tasks`, `/leads/export`) · migration order (9) ✔ · secret scan ✔ · **RLS harness 95/95** (migrations 0001–0009 from clean DB + seed).

**Deferred to §29 / Phase 9 (infra & analytics, intentionally not in Phase 3):** durable **PGMQ** queue workers (ingestion runs inline today — structured and idempotent-ready, but not yet on a durable queue), the **funnel analytics** view, and a no-code **assignment-rules editor** (the deterministic engine exists; the rule-builder UI is an admin surface for Phase 9).

**Blocker (unchanged):** official `supabase db reset` + `supabase test db` still must be run + recorded; the gate remains red by design.

## Phase 3.1 — CRM Conversation Readiness (2026-06-19)

Hardening milestone executed **before** any Phase 4 work. No live Supabase, no
WhatsApp/AI/RAG/scoring/automated follow-ups.

**Delivered:**

- **DB-enforced idempotency** (migration `0010`): `idempotency_keys`,
  `lead_ingestion_events` (unique `(tenant,key)` + partial unique
  `(tenant,source,external_event_id)`), `lead_ingestion_attempts`. Ingestion is
  now **persist-before-process**; duplicate/concurrent events fail at the storage
  layer and are translated to an idempotent hit (same payload) or a rejection
  (same key, different payload hash) — repeated events never duplicate leads,
  assignments, attribution, duplicate-candidates, activities, or audit rows.
- **Durable-job abstraction** (`lib/jobs/*`): repository + processor interface +
  `SyncLocalDriver` (inline; explicitly **not** a production worker), `OutboxDriver`,
  and a `PgmqDriver` interface that throws until live Supabase. Retry/backoff,
  max-attempts, dead-letter transition (`dead_letter_events`), manual replay,
  correlation IDs.
- **Ingestion surfaces:** `POST /api/v1/leads` (hashed api-key, timestamp,
  rate-limit, idempotency header, versioned response), `POST /webhooks/leads/[source]`
  (api-key OR HMAC; synthetic adapters: generic, NoBroker, 99acres, Housing, Meta,
  Google), and hardened `POST /api/forms/[formId]` (origin allow-list, size cap,
  rate limit, replay window, honeypot, consent; **never reveals if a contact
  exists; no tenant id / DB-error leakage**).
- **CRM completeness:** calls domain + log form + history + callback-task (no
  telephony); configurable **qualification completeness** (info metric, not a
  score); **saved views** (scope never widens RLS); **pipeline lost/disqualified
  reason enforcement**; lead-detail panels + **mobile sticky actions** (Call /
  WhatsApp external link / Note / Task / Stage); first-touch-preserving attribution;
  formula-injection-safe CSV export.

**Verification:** typecheck ✔ · unit **52/52** ✔ · lint ✔ · prettier ✔ · build ✔ ·
secret scan ✔ · migration order (10) ✔ · **RLS + idempotency harness 123/123**
(migrations 0001–0010 from clean DB + seed). The harness caught and we fixed a real
isolation bug (a `calls_write FOR ALL` policy was widening `SELECT` past the
lead-visibility rule). See [`PHASE_3_1_AUDIT.md`](./PHASE_3_1_AUDIT.md) for the full
requirement matrix (Complete / Partial / Missing) and accepted deferrals.

**Status:** Phase 3 — Locally Complete and Verified / Live Supabase — Deferred /
Production Verification — Pending. **Phase 4 not started.**

## Phase 4 — Conversations (2026-06-19)

Conversation infrastructure: message/conversation model, shared + agent inbox,
website chat widget, human takeover, deterministic summaries, and the consent/DNC
model. **AI answering is Phase 5** (conversations carry an `ai_active` flag the
future responder must respect; summaries are produced deterministically now).
**Supabase Realtime** (live push) is deferred — the inbox is server-rendered.

**Delivered:**

- **Migration `0011`:** `conversations`, `conversation_messages` (idempotent
  inbound via `external_message_id`), `conversation_participants`,
  `conversation_summaries`, `conversation_events`, `website_chat_widgets`,
  `contact_consents`. RLS: `read.private` (all) vs `read.assigned` (own
  conversation/lead); child tables inherit visibility; writes split per-command
  (no `FOR ALL` SELECT-widening); Project Maintenance denied private
  conversations. 8 new audit actions.
- **Domain (pure, unit-tested):** `buildDeterministicSummary`, `isContactable`
  (DNC), `needsResponse` (SLA).
- **Inbox:** `/inbox` (filters: all / mine / unassigned / AI-active / human
  takeover / needs-response / closed) and `/inbox/[id]` (thread, reply box,
  lead-context, summary, event log; take-over / resume / transfer / close /
  generate-summary controls — each permission-gated). Inbox added to desktop and
  mobile nav.
- **Server actions:** reply (DNC + consent + permission enforced before send),
  takeover (pauses AI), resume, transfer, close/reopen, generate-summary, update
  consent — all audited.
- **Website chat widget:** hardened public `POST /api/chat/[widgetId]/start` and
  `/message` (origin allow-list, size cap, rate limit, timestamp window,
  honeypot, consent; idempotent ingest + inbound). Non-disclosing responses; no
  secrets to the browser.

**Verification:** typecheck ✔ · unit **62/62** ✔ · lint ✔ · prettier ✔ · build ✔ ·
secret scan ✔ · migration order (11) ✔ · **RLS harness 138/138** (migrations
0001–0011 from clean DB + seed). See [`CONVERSATIONS.md`](./CONVERSATIONS.md).

**Status:** Phase 4 — Locally Complete and Verified / Live Supabase — Deferred /
Production Verification — Pending. **Phase 5 not started.**

## Phase 4.1 — AI Safety & Inbox Completion (COMPLETE, locally verified 2026-06-19)

> **Status correction (2026-06-20):** Phase 4.1 is **complete and locally
> verified** — see `docs/PHASE_4_1_COMPLETION_AUDIT.md` (all required inbox
> workflows wired; harness was 197/197 at 4.1 close, now 251+ after Phase 5A).
> The narrative below was written mid-build and is retained only as a historical
> record of the foundation; it is superseded by the completion audit. The earlier
> "(in progress)" wording was stale and has been corrected.

No live Supabase; no AI/RAG/scoring/WhatsApp/automated follow-ups in 4.1.

**Done and verified (foundation):**

- **Hard AI execution boundary** — `canExecuteAutomatedReply` (single guard,
  `AI_RESPONDER_INSTALLED=false` → always denied), `resumeTargetMode`
  (never `ai`). Resume control relabelled "End takeover (pause)" and can only set
  `human`/`paused`; conversations gain `operating_mode`/`lifecycle`/`priority`/
  `waiting_on`. Unit-tested.
- **Migration `0012`** — assignment/transfer/status/priority history, per-user
  reads, SLA policies+events, message delivery events, message
  ingestion/idempotency/attempts/DLQ, internal notes (+versions), canned replies
  (+categories), tags, consent lifecycle + DNC, redaction, attachment metadata,
  website sessions, summary versions (CHECK: no `ai_generated`, no model/prompt).
  18 new permissions, new-tenant-safe via `grant_phase41_conversation_perms`.
  Every new table has direct RLS assertions.
- **Domain (pure, tested):** `computeWaitingOn`, `validateDeliveryTransition`,
  `resolveCannedReply` (allow-list only), `computeSlaStatus`.
- **Wired actions/UI:** status/priority change (+history), internal notes panel,
  mark-read (own-row only), message redaction (hash-only audit), DNC entry,
  operating-mode controls.

**Tech-debt closed (migrations `0013`–`0014` + wiring, 2026-06-19):** waiting-on +
delivery events (DB triggers; failed delivery re-flags the agent), inbound
message-ingestion pipeline (`/api/chat/message` persists an idempotent ingestion
event + attempt before the message), transfer history + assignment rows, consent
events on DNC, summary versioning, the inbox History panel
(status/priority/transfer), **base role bundles folded into `seed_default_roles`
(0014; new-tenant safe)**, **a Marketing Manager seed user proving metadata-only
access at runtime**, and **search-authorization RLS safety**.

**Verification:** typecheck ✔ · unit **114** ✔ · lint ✔ · prettier ✔ · build ✔ ·
secret scan ✔ · migration order (15) ✔ · **RLS harness 190/190** (0001–0015).
Full per-item status: [`PHASE_4_1_COMPLETION_AUDIT.md`](./PHASE_4_1_COMPLETION_AUDIT.md).

**Latest pass also closed:** the **polling transport** (`domain/cursor.ts` opaque
cursors + `lib/transport/*` + `fetchSinceAction`; 5 unit), the **embeddable widget
runtime** (`/widget.js`, `/chat/widget`, `/chat/demo`, install page + admin
actions, token-scoped polling endpoint), **visitor read-state** (migration `0015`),
and the **SLA policy-precedence resolver** (`resolveSlaPolicy`; 4 unit). Still open:
SLA event emission, canned-reply + tag + saved-view UIs, mobile inbox, the
polling→inbox-detail wiring, and the widget unread badge.

**Closed/advanced in recent passes (2026-06-19):** website session security
(`lib/chat/session.ts`; 6 unit + 7 harness), permission-safe inbox search
(`searchInbox` + `buildSnippet`; 3 unit + 2 harness), the **SLA working-hours
engine** (`packages/domain/src/sla.ts`: tz offset / overnight / weekend / holiday
/ closed-week; 7 unit; first-response chip on detail), **unread derivation**
(`deriveUnread`; 3 unit; inbox header total + per-row dot), and **assignment +
owner-mismatch** (`assign-actions.ts` assign/unassign/lock/resolve + `detectOwnerMismatch`
warning). Unit suite now **105**; harness **190/190**.

**Still not wired (blocks completion):** SLA event emission + project/channel
overrides + list/mobile chips, canned-reply composer + management, tag
filter/management, interactive assign/team UI + availability/workload gating,
widget install script + demo, polling transport, saved inbox views, mobile inbox
sheets, mobile-nav/widget unread badges, full consent lifecycle UI. Full per-item
status in
[`PHASE_4_1_COMPLETION_AUDIT.md`](./PHASE_4_1_COMPLETION_AUDIT.md); remediation in
[`TECH_DEBT.md`](./TECH_DEBT.md).

**Status:** Phase 4.1 — Foundation Locally Complete and Verified / Feature wiring
In Progress / Live Supabase — Deferred / Production Verification — Pending.
**Stopped for review; Phase 5 not started.**

## Decision log

- Provider-adapter abstraction for AI; PGMQ for queues; next-intl for i18n; Supabase Realtime for live inbox; embeddings provider configured independently of chat model. Full list and rationale in [`CONTRADICTIONS.md`](./CONTRADICTIONS.md) and [`ASSUMPTIONS.md`](./ASSUMPTIONS.md).
