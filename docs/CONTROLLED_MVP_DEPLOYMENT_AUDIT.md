# Controlled MVP — Production Deployment Readiness Audit

**Profile:** `DEPLOYMENT_PROFILE=controlled_mvp`, `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false`,
`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`.
**Date:** 2026-06-20 · **Migration range:** 0001–0026 · **Scope:** core CRM + website chat +
advisory scoring/matching; integrations simulation-only; no live provider IO.

> **Decision: NO-GO — PENDING HOSTED STAGING VERIFICATION.** The codebase and all
> _locally-verifiable_ gates pass. The remaining go/no-go inputs (a hosted staging Supabase,
> backup/restore drill, hosted RLS run, end-to-end browser smoke, live observability,
> performance baseline) **cannot be executed from this build environment** — they require a
> provisioned cloud environment, deployment, and monitoring services. Those steps are written
> below as runbooks to execute in staging; the "Production Controlled MVP Approved" status is
> **withheld** until they pass with a named approver.

---

## 1. Local gate evidence (PASS — reproducible here)

| Gate                     | Result                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `pnpm install --frozen`  | PASS                                                             |
| `pnpm format:check`      | PASS                                                             |
| `pnpm lint`              | PASS — 0 errors (1 pre-existing unrelated warning)               |
| `pnpm typecheck`         | PASS                                                             |
| `pnpm test` (unit)       | PASS — **331** (incl. 7 production-env-validation tests)         |
| `pnpm test:web`          | PASS — **16** apps/web server tests (runtime no-IO trap active)  |
| `pnpm test:pg`           | PASS — **32** embedded-PostgreSQL real-service scenarios         |
| RLS harness              | PASS — **349/349** assertions (migrations 0001–0026)             |
| `pnpm verify:migrations` | PASS — 26 sequential (0001–0026)                                 |
| `pnpm verify:secrets`    | PASS                                                             |
| `verify:no-external-io`  | PASS — static **and** runtime (fetch/http/https/net/tls trapped) |
| `pnpm build`             | PASS — 16 UI pages + 2 webhook API routes compiled               |

**Migrations 0025 / 0026 (latest):** `0025_external_event_envelopes.sql` — authenticated
receipt-before-parse envelope, opaque `public_id` webhook endpoint, `external_events.envelope_id`
link. `0026_callback_idempotency.sql` — `uniq_wa_provider_event_ref_kind` (tenant,
provider_message_ref, kind) + tenant-scoped delivery-ref lookup index.

**Route inventory (corrected):** **16 UI pages** under `/settings/integrations*` + `/integrations/events`;
**2 public webhook API routes** — `/api/integrations/webhooks/[publicEndpointId]` (opaque, preferred)
and `/api/integrations/[connectionId]/webhook` (legacy) — both gated OFF by
`INTEGRATION_PUBLIC_WEBHOOKS_ENABLED`; plus the existing website-chat + lead API/form routes.
Internal fixture/test surfaces (embedded-PG tests, mock adapters) are test-only and never shipped.

**Replay executor + delivery-callback lifecycle (embedded-PG verified):** `executeReplay`
(local, idempotent, rejects `resubmission_required`, append-only attempts) and the
callback lifecycle (`validateDeliveryTransition`, tenant-scoped, never creates a message,
unknown-ref → review) — see `PHASE_7A_AUDIT.md` §12.

---

## 2. Environment separation (code in place; provisioning is hosted)

Required separation — **each** of local / CI / staging / production uses its **own**: Supabase
project, database, auth config, service-role key, app secret, widget credentials, public URL,
logging destination, error-monitoring environment, and data-retention config. Production must
never reuse local/CI/staging secrets.

**Implemented:** `packages/config/src/env.ts` now fails startup when a **production** deploy is
incomplete — `getServerEnv()` calls `assertDeploymentReady()`, which requires `SENTRY_DSN`
(error monitoring) + service-role key, an `https` non-localhost `NEXT_PUBLIC_APP_URL`, and
**rejects** `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=true` under `controlled_mvp`. 7 unit tests
(`deployment-env.test.ts`). **Pending (hosted):** create the four real Supabase projects + secret
sets; this audit cannot provision cloud resources.

## 3. Staging-first provisioning — RUNBOOK (not executed here)

Provision a hosted staging Supabase; apply **forward-only** `0001–0026` (`supabase migration up` /
linked `supabase db push`). **Never** run `supabase db reset` against staging/production once it
holds persistent data. Verify: extensions, functions, triggers, RLS policies, permissions, seed
strategy, Storage-disabled behaviour, pgvector availability (+ portable fallback). Do **not** load
broad synthetic seed into production — create only an approved bootstrap tenant + admin.

## 4. Production database safety — RUNBOOK

Establish automated backups + PITR, retention policy, restore procedure, migration rollback/
forward-fix procedure + named owner, connection limits, statement timeouts, slow-query + index-health

- db-size monitoring. **Restore drill** (disposable env), recording: backup created → restore started
  → restore completed → post-restore app smoke. _Status: pending hosted env._

## 5. Production authentication — RUNBOOK

Verify production callback URLs, secure-cookie behaviour, session expiry, password-reset, invitation
flow, sign-out, tenant switching, disabled-user / removed-membership / expired-invitation behaviour,
rate limits, generic auth errors, no account-enumeration. Create one test account per role (Client
Admin / Sales Manager / Sales Agent / Marketing Manager / Project Data & Maintenance / Viewer /
Platform Admin). _Status: pending hosted auth config._

## 6. Hosted RLS verification — RUNBOOK

Run **non-destructive** RLS checks against staging fixtures (remove after): tenant isolation,
assigned-lead/conversation visibility, project/inventory/task/audit/scoring/matching/integration-
metadata isolation, platform-admin no-silent-tenant-access. Locally this is already proven by the
349-assertion embedded-PG harness; the hosted run re-confirms on real infra. _Pending._

## 7. Feature-gate verification (controlled_mvp)

**Enabled & built:** auth, tenant branding, projects/configs/inventory, lead create+import+dedupe+
assignment, pipeline, tasks, manual inbox, website chat, consent/DNC, advisory scoring, advisory
matching, knowledge admin, AI test/shadow/copilot (cannot send). **Disabled (absent/labelled, not
active):** public provider webhooks, real WhatsApp/Gmail/SMTP/IMAP/Pub-Sub, Meta/Google lead, portals,
binary-media retrieval, automatic scoring/matching actions, automatic AI replies, production sends.
The integration admin **Environment status** panel renders each as disabled/simulation. _Verified by
build + route/service tests; final visual confirmation is part of the hosted smoke (§9)._

## 8. Website-chat production test — RUNBOOK (logic locally tested)

On staging, exercise: allowed/disallowed domain, widget load, session create/return/expiry, token
rotation, clear-chat, inbound + duplicate message, agent reply, visitor polling + unread, agent
unread, waiting-on, SLA event, human takeover, close/reopen, DNC, consent change, widget pause,
session revocation — and confirm **no AI reply is delivered**. The underlying logic is covered by the
session/transport/SLA unit + embedded-PG message-ingestion tests; the hosted pass validates real
origin checks + polling latency. _Pending hosted env._

## 9. Controlled-MVP end-to-end smoke (35 steps) — RUNBOOK

The full sign-in → branding → invite → project/inventory → lead/import/dedupe → assign → pipeline →
task → website-chat → reply → transfer → DNC → search → canned reply → tag → advisory score/match →
override → knowledge → AI test lab (nothing sent) → integration admin (simulation labels, webhooks
disabled, no unsafe credential fields, no live WhatsApp/email) → export → audit-log review. Each step
must record pass/fail + tester + timestamp + evidence. **Requires a deployed app + live Supabase +
a browser; not runnable in this build sandbox.** Every step's behaviour is otherwise covered by
build + route/service/harness tests.

## 10. Observability — RUNBOOK + redaction policy (enforced in code)

Add/verify: error monitoring (Sentry — now required in prod by env validation), structured server
logs with correlation IDs, db-error + auth-failure + rate-limit alerts, website-chat ingestion-failure
visibility, job-failure + dead-letter visibility, audit-log monitoring, health-check endpoint, uptime
monitoring. **Logs must never contain** access/refresh/service-role/session tokens, customer message
bodies by default, full emails/phones where unnecessary, raw integration payloads, or authorization
headers — already enforced by `redactSecrets`, the normalized-payload minimizer, and audit redaction;
the hosted log destination must be configured to honour it.

## 11. Rate limits & abuse controls — RUNBOOK

Confirm production limits + generic (non-tenant-disclosing) failures for: sign-in, password-reset,
invitations, public website-chat start/message, public lead forms, lead API, enabled lead webhooks,
CSV import, export, search, AI test lab, scoring + matching recalculation. The rate-limit primitives
exist (`lib/leads/rate-limit`); production thresholds are tuned against the §15 baseline.

## 12. Data retention & privacy — RUNBOOK

Document + configure retention for leads, conversations, messages, audit logs, AI runs, knowledge
docs, integration events; plus deleted-user handling, contact deletion/anonymization, export process,
consent history, DNC retention, backup retention. **Do not enable any live external integration until
a separate privacy/compliance review is completed.**

## 13. First-tenant onboarding — CHECKLIST

Tenant created · branding configured · admin created · sales team invited · roles reviewed · projects
imported · inventory imported · lead sources configured · pipeline reviewed · assignment rules reviewed
· widget installed · allowed domains configured · consent wording reviewed · DNC workflow demonstrated
· scoring explained as advisory · matching explained as advisory · simulation-only integrations
explained · support contact provided · backup/rollback confirmed. **Onboard only one pilot tenant until
a stable observation period passes.**

## 14. Rollback plan

**Triggers (launch-stopping in bold):** auth outage · **cross-tenant data exposure** · incorrect
permission behaviour · data corruption · lead-duplication spike · website-chat message loss · migration
failure · severe perf degradation · **unexpected external IO** · **any automatic message-send attempt**.
**Procedure:** disable the affected feature (and website chat if needed) → preserve evidence → stop
background jobs → revoke exposed credentials → restore or forward-fix the database → notify operators →
**re-validate tenant isolation after recovery**. Any cross-tenant exposure or automatic-send attempt is
a launch-stopping incident.

## 15. Performance baseline — RUNBOOK (measure on staging)

Measure median + p95, db-query count, slowest queries, memory, build size, cold-start for: dashboard,
lead list/detail, pipeline, inbox, conversation detail, project list/detail, inventory list, scoring +
matching panels, audit log, website-chat ingestion. **Set alert thresholds from measured values, not
assumptions.** _Pending hosted env; the production build size is already emitted by `pnpm build`._

## 16. Go / No-Go

| Input                             | State                                             |
| --------------------------------- | ------------------------------------------------- |
| Local gates (tests/scans/build)   | ✅ PASS                                           |
| Production env-validation (code)  | ✅ PASS (fails startup on incomplete prod config) |
| Environment provisioning (4 envs) | ⛔ PENDING — hosted, not provisionable here       |
| Staging migrations 0001–0026      | ⛔ PENDING — hosted                               |
| Backup + restore drill            | ⛔ PENDING — hosted                               |
| Hosted RLS run                    | ⛔ PENDING (local harness ✅)                     |
| End-to-end browser smoke (35)     | ⛔ PENDING — needs deployed app + live Supabase   |
| Observability + uptime wiring     | ⛔ PENDING — hosted services                      |
| Rate-limit production tuning      | ⛔ PENDING — needs §15 baseline                   |
| Performance baseline              | ⛔ PENDING — hosted                               |
| Named approver                    | ⛔ PENDING                                        |

**Decision: NO-GO — PENDING HOSTED STAGING.** Promote to the status below **only after** §3–§15
pass in a real staging environment with a named approver:

```
Core CRM — Production Controlled MVP Approved
Phase 7A — Locally Complete and Simulated
Phase 7B — Awaiting External Provider Approval
Public Provider Webhooks — Disabled
Live WhatsApp/Email — Not Connected
Automatic Customer Sending — Impossible
```

Until then the authoritative status remains:

```
Core CRM — Locally Ready for Controlled MVP
Production Controlled MVP — NO-GO Pending Hosted Staging
Phase 7A — Locally Complete and Simulated
Phase 7B — Not Started
Public Provider Webhooks — Disabled
Live WhatsApp/Email — Not Connected
Automatic Customer Sending — Impossible
```

**Known limitations:** no hosted environment available in this build sandbox, so all cloud-dependent
verification (provisioning, backups, hosted RLS, browser smoke, observability, performance) is
documented as runbooks rather than executed; production durable queues (PGMQ workers) remain deferred
(local-sync today); live external providers remain Phase 7B (credentials + compliance gated).

---

## 17. Hosted-staging execution pack — local artifacts added (PASS, reproducible here)

These were built and verified locally to make the hosted verification repeatable and hard to do
wrong. None require cloud credentials.

| Artifact                                                                                                        | What it gives the operator                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config/src/env.ts` (strengthened) + **11** unit tests                                                 | Prod startup fails on missing Supabase URL/anon/app-URL/session secret/Sentry, on a secret leaked via `NEXT_PUBLIC_*`, or on any safety gate flipped on. |
| `packages/validation/src/redaction.ts` + **6** tests                                                            | Log-safe redaction: phone, email, tokens, headers, URL credentials, provider errors.                                                                     |
| `apps/web/src/app/api/health/route.ts`                                                                          | Liveness/readiness; reports profile + webhooks-disabled + live-send-disabled; **no secrets**.                                                            |
| `scripts/db-preflight.mjs` (`db:staging:preflight`, `db:production:preflight`)                                  | READ-ONLY forward-only migration preflight (sequence + gates + project ref); applies nothing.                                                            |
| `scripts/hosted-rls-verification.mjs` (`hosted:rls`) + `HOSTED_RLS_VERIFICATION.md`                             | Staging-only RLS run; refuses production; synthetic prefixed tenants; prefix-scoped cleanup; JSON+MD report.                                             |
| `scripts/staging-performance-baseline.mjs` (`perf:baseline`) + `PERFORMANCE_BASELINE.md`                        | Conservative staging latency baseline (median/P95/P99/error rate).                                                                                       |
| `e2e/` Playwright skeleton + `test:e2e:compile`                                                                 | Compilable browser smoke (sign-in, protected redirect, shell pages, `/api/health`, simulation posture); no embedded credentials.                         |
| `HOSTED_STAGING_RUNBOOK.md`, `ENVIRONMENT_MATRIX.md`, `CONTROLLED_MVP_SMOKE_TEST.md`, `BACKUP_RESTORE_DRILL.md` | Exact, tagged operator steps (LOCAL/CI/STAGING/PROD/DESTRUCTIVE).                                                                                        |

## 18. Named approval (required to promote — none of these may be automated)

Promotion to _Production Controlled MVP Approved_ requires **all** of the following to be filled by
the responsible humans:

| Field                              | Value     |
| ---------------------------------- | --------- |
| Technical approver                 |           |
| Product approver                   |           |
| Operations owner                   |           |
| Security / privacy acknowledgement |           |
| Approval date                      |           |
| Approved commit (SHA)              |           |
| Approved migration range           | 0001–0026 |
| Approved environment               |           |
| Known-limitations acknowledged     | ☐         |

An anonymous or automated approval is **not** sufficient and must never set the production status.

## 19. Promotion rule

Promotion is allowed **only when every one** of the following passes:

1. Staging deployment passes (app serving, env-status panel correct).
2. Forward-only migrations pass (`db:*:preflight` + `supabase db push`, no `db reset`).
3. Hosted RLS passes (`hosted:rls` → PASS).
4. Backup restore passes (`BACKUP_RESTORE_DRILL.md`, RTO/RPO recorded).
5. 35-step smoke passes (`CONTROLLED_MVP_SMOKE_TEST.md`, no FAIL).
6. Website chat passes (no AI reply delivered).
7. Observability is receiving events (Sentry + structured logs, redaction honoured).
8. Uptime monitor is active against `/api/health`.
9. Performance baseline is acceptable (thresholds agreed with ops).
10. Rollback procedure is confirmed (§14).
11. A named human approver signs off (§18).

Only when all 11 hold may the status change to the _Production Controlled MVP Approved_ block in
§16. Until then it remains the NO-GO block in §16.
