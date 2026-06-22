# Phase 3.1 Audit — CRM Conversation Readiness

**Date:** 2026-06-19
**Scope:** Harden lead ingestion, idempotency, durable-job abstraction, CRM
completeness (calls, qualification completeness, saved views, pipeline rules,
secure export, attribution) **before** any Phase 4 (Conversations / WhatsApp /
AI / scoring) work.

**Constraints honoured:** No live Supabase project was connected. No WhatsApp,
AI answering, RAG, scoring, or automated follow-ups were implemented. No paid
service was contacted. The WhatsApp action on the lead detail is an external
deep link only.

**Status string:**
`Phase 3 — Locally Complete and Verified / Live Supabase — Deferred / Production Verification — Pending`

---

## 1. Verification results (8 gates)

All gates executed on a sandbox-local copy of the repository (the connected
folder mount blocks `unlink`, so dependencies cannot be installed in place — see
`CLAUDE.md` §4). Commands and outcomes:

| Gate                      | Command                                                                                                                               | Result                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Type safety               | `pnpm typecheck` (strict, all packages)                                                                                               | **PASS**                                              |
| Unit tests                | `pnpm test` (Vitest)                                                                                                                  | **PASS — 52 passed (7 files)**                        |
| Lint                      | `pnpm lint` (ESLint flat + Next plugin)                                                                                               | **PASS**                                              |
| Formatting                | `pnpm format:check` (Prettier)                                                                                                        | **PASS**                                              |
| Production build          | `pnpm build` (Next.js)                                                                                                                | **PASS**                                              |
| RLS / idempotency harness | embedded-Postgres harness (`supabase/tests/local-harness/run.mjs`, migrations `0001`–`0010` + seed, as non-superuser `authenticated`) | **PASS — 123 passed, 0 failed**                       |
| Secret scan               | grep for `service_role` / `SERVICE_ROLE` reaching client code                                                                         | **PASS — only `lib/supabase/admin.ts` (server-only)** |
| Migration apply           | `0001`–`0010` applied cleanly from clean DB in the harness                                                                            | **PASS**                                              |

> The embedded-Postgres harness is a developer-convenience reproduction of RLS.
> The **authoritative** database verification remains `supabase test db` (pgTAP)
> on a Docker-capable CI runner against a real Supabase stack — that is part of
> the deferred _Production Verification — Pending_ gate.

### Bug found and fixed during verification

The RLS harness caught a real isolation defect: the original `calls_write`
policy was declared `FOR ALL`, which in PostgreSQL also governs `SELECT`. Because
a permissive policy is OR-ed with the lead-scoped `calls_select` policy, any user
holding `calls.manage` could read **every** call in the tenant — bypassing the
"a call is visible only if the lead is visible" rule (an agent could see calls on
leads not assigned to them). Fixed by splitting writes into per-command
`calls_insert` / `calls_update` / `calls_delete` policies (insert/update also
require the lead to be visible), leaving `SELECT` solely to the lead-scoped
policy. Re-run: 123/123.

---

## 2. Requirement matrix

Classification is deliberately conservative. A schema placeholder, comment, or
planned interface is **not** counted as a completed feature.

| #   | Requirement                       | Status                                   | Where it lives                                                                                                                                                                                             | Tests / Security                                                                                                                                                                            |
| --- | --------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Idempotency (DB-enforced)**     | **Complete**                             | `0010` tables `idempotency_keys`, `lead_ingestion_events` (unique `(tenant,key)` + partial unique `(tenant,source,external_event_id)`); `lib/leads/ingest.ts` persist-before-process with `23505` handling | Harness: same-event-twice rejected, same-key-diff-tenant allowed, same source+external twice rejected, idempotency_keys uniqueness                                                          |
| 2   | **Generic API ingestion**         | **Complete**                             | `app/api/v1/leads/route.ts` (`x-form-id` + hashed `x-api-key`, timestamp tolerance, rate limit, size cap, idempotency-key header, versioned response, safe errors)                                         | Credential compare is constant-time (`safeEqualHex`); errors non-disclosing                                                                                                                 |
| 3   | **Generic webhook ingestion**     | **Complete**                             | `app/webhooks/leads/[source]/route.ts` (adapter-per-source; api-key hash OR HMAC; timestamp; rate limit)                                                                                                   | Synthetic adapters: generic, NoBroker, 99acres, Housing, Meta, Google                                                                                                                       |
| 4   | **Public-form security**          | **Complete**                             | `app/api/forms/[formId]/route.ts` + `0010` `public_lead_forms` / `_domains` / `_submissions`                                                                                                               | Origin allow-list, size cap, rate limit, timestamp replay window, honeypot (silent 202), consent gate, correlation id; never reveals if phone/email exists; no tenant id / DB error leakage |
| 5   | **Ingestion retries**             | **Complete**                             | `packages/domain/src/retry.ts` (`decideAfterFailure`, exponential backoff, max attempts); `lead_ingestion_events.next_retry_at` / `attempt_count`                                                          | Domain unit tests (retry → backoff → exhausted → dead_letter)                                                                                                                               |
| 6   | **Dead-letter handling**          | **Complete**                             | `0010` `dead_letter_events`; `lib/jobs/repository.ts` `replayDeadLetter`; ingest dead-letters on exhaustion                                                                                                | Harness: DLQ visible only to `settings.audit.read`                                                                                                                                          |
| 7   | **Calls**                         | **Complete**                             | `0010` `calls` (enum `call_status`); `logCallAction`; `CallLogForm` + history + outcome + callback-task on lead detail; mobile call action                                                                 | Harness: lead-scoped visibility, agent insert on assigned lead, cross-tenant denial. **No telephony integration** (per constraint)                                                          |
| 8   | **CSV import**                    | **Complete (basic)**                     | `importLeadsAction` + `lib/inventory/csv.ts`; maps name/phone/email/campaign/source                                                                                                                        | Invalid rows skipped; duplicates flagged via dedupe                                                                                                                                         |
| 9   | **XLSX import (leads)**           | **Missing**                              | Inventory has XLSX import (Phase 2); **lead** import is CSV-only                                                                                                                                           | Deferred — see §4                                                                                                                                                                           |
| 10  | **Saved views**                   | **Partial**                              | `0010` `saved_views` (scope private/team/tenant); `saveViewAction` / `deleteViewAction` (scope never widens RLS)                                                                                           | Harness: owner-only write, private invisibility to others, team needs `leads.read.team`. **Apply / duplicate / set-default / share UI not yet built**                                       |
| 11  | **Qualification completeness**    | **Complete (core) / Partial (surfaces)** | `packages/domain/src/qualification.ts` (`computeCompleteness`); seeded `qualification_fields`; lead-detail panel                                                                                           | Domain unit tests (3). Shown on **detail**; list / pipeline-card / import-preview surfaces are **Partial**. Explicitly **not** a quality score                                              |
| 12  | **Lead custom fields**            | **Partial**                              | `0010` `lead_custom_fields` / `_values` (+ RLS)                                                                                                                                                            | Harness covers config/value RLS via shared policy; **no admin UI yet**                                                                                                                      |
| 13  | **Campaign / UTM attribution**    | **Complete**                             | `ingest.ts` first-touch never overwritten; last-touch appended on repeat events; `attribution_touchpoints`                                                                                                 | Domain/integration coverage; idempotent repeat events do not duplicate touchpoints                                                                                                          |
| 14  | **Agent workload**                | **Partial**                              | Assignment engine (`packages/domain/src/assignment.ts`, Phase 3) computes load-aware assignment                                                                                                            | No dedicated workload dashboard surface yet                                                                                                                                                 |
| 15  | **Assignment-rule configuration** | **Partial (deferred)**                   | Deterministic engine + `assignment.configure` permission                                                                                                                                                   | Advanced no-code builder is an accepted deferral (§4)                                                                                                                                       |
| 16  | **Broker-conflict resolution**    | **Complete**                             | Phase 3 `0009` overlap detection + commission resolution UI                                                                                                                                                | Phase 3 harness + this run                                                                                                                                                                  |
| 17  | **Secure export**                 | **Partial**                              | `app/(app)/leads/export/route.ts` — RLS-scoped, permission-gated (`leads.export`), row cap (5000), audited; CSV with **formula-injection escaping** (`= + - @` prefixed)                                   | CSV path complete & safe. **XLSX export, column selection, and background-export interface are Missing/Deferred**                                                                           |
| 18  | **Lead archive**                  | **Missing**                              | Soft-delete exists via merge (`deleted_at`, `merged_into_lead_id`); no explicit archive action/lifecycle                                                                                                   | Deferred — see §4                                                                                                                                                                           |
| 19  | **Lost-reason enforcement**       | **Complete**                             | `moveStageAction` blocks moves into `is_lost` stages without a reason; sets `operational_status`; writes stage + audit history; `StageMover` shows a required reason field                                 | Pipeline rule enforced server-side, not only client-side                                                                                                                                    |

### Honesty notes

- **Lead-source channels are auto-resolved/created by `kind`** during ingestion
  (e.g. a first NoBroker lead creates the "NoBroker" _source_ row). This is an
  ingestion _channel_, not one of the prohibited entities. Imports do **not**
  silently create projects, agents, campaigns, or pipeline stages — `campaign`
  is a free-text column, and stage/assignment resolution only reads existing
  rows.
- **Idempotency is enforced by the database**, not by application bookkeeping
  alone: the unique constraints make concurrent/duplicate inserts fail at the
  storage layer, and the app translates `23505` into an idempotent hit
  (same payload) or a rejection (same key, different payload hash).
- **`SyncLocalDriver` is explicitly not a production background worker.** It runs
  processors inline for local development; the `PgmqDriver` throws until a live
  Supabase/PGMQ stack exists (accepted deferral).

---

## 3. New-table RLS coverage (this run)

Every Phase 3.1 table created in `0010` is RLS-default-deny and was asserted in
the harness:

| Table                                                          | Read rule asserted                                                               | Write/visibility asserted                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `lead_ingestion_events`                                        | admin (`leads.read.team` via `read.all`) sees rows; agent sees 0; cross-tenant 0 | unique constraints (idempotency)                          |
| `lead_ingestion_attempts`                                      | inherits `leads.read.team`                                                       | (covered by parent)                                       |
| `idempotency_keys`                                             | —                                                                                | unique `(tenant,scope,key)`                               |
| `background_jobs`                                              | admin (`settings.audit.read`) sees; agent 0                                      | —                                                         |
| `dead_letter_events`                                           | admin (`settings.audit.read`) sees; agent 0                                      | —                                                         |
| `public_lead_forms`                                            | admin (`forms.manage`) sees; agent 0                                             | agent cannot insert; cross-tenant 0                       |
| `saved_views`                                                  | owner sees own private; others cannot                                            | agent cannot create view owned by another user            |
| `calls`                                                        | visible **iff** lead visible (agent: assigned only)                              | agent can log on assigned lead; cross-tenant 0            |
| `qualification_fields`                                         | members with `leads.read.assigned` read                                          | agent (no `settings.org.manage`) cannot edit; admin can   |
| `lead_qualification_values` / `lead_custom_fields` / `_values` | read by lead-area members                                                        | config by `settings.org.manage`; values by `leads.update` |

---

## 4. Accepted deferrals (structures/interfaces exist now; execution later)

These are explicitly out of local scope and require a live environment or paid
service; the DB structures, interfaces, and security are in place today:

- **PGMQ execution** — `PgmqDriver` interface present; throws until live Supabase.
- **Realtime** — none used.
- **Production webhook delivery** — routes + signature/idempotency complete; live
  provider registration is a production action.
- **Storage / large-file background exports** — `background_jobs` +
  export-interface exist; large-file export execution deferred.
- **Funnel analytics beyond real counts** — only real counts are shown.
- **Advanced no-code assignment-rule builder** — deterministic engine + permission
  exist; visual builder deferred.
- **Lead XLSX import, import mapping templates/preview/duplicate-preview/failed-row
  replay** — CSV import works; richer mapping pipeline deferred.
- **Saved-view apply/duplicate/set-default/share UI, lead custom-field admin UI,
  lead archive lifecycle, XLSX/column-select/background export** — DB + RLS exist;
  full UI deferred.

---

## 5. What changed in this milestone

- **Migration `0010`** (idempotency, durable jobs, public forms, calls, saved
  views, qualification + custom fields) — with split per-command `calls_*`
  policies after the RLS fix.
- **`packages/domain`**: `retry.ts`, `qualification.ts` (+ unit tests).
- **`packages/validation`**: `logCallSchema`, `saveViewSchema`, `call_status`
  values aligned to the DB enum.
- **`apps/web`**: idempotent persist-before-process `ingest.ts`; durable-job
  abstraction (`lib/jobs/*`); `/api/v1/leads`, `/webhooks/leads/[source]`,
  hardened `/api/forms/[formId]`; synthetic adapters; rate-limit + request
  security helpers; calls / qualification / saved-view server actions;
  pipeline lost-reason enforcement; lead-detail panels + mobile sticky actions;
  formula-injection-safe CSV export.
- **Harness**: migration `0010` added; idempotency + new-table RLS assertions
  (123 total).

Docs updated in the same change: `BUILD_STATUS.md`, `LEAD_CRM.md` (new),
`LEAD_INGESTION.md` (new), `SECURITY.md`, `DATABASE.md`, `TEST_PLAN.md`,
`API_MAP.md`, `PAGE_MAP.md`.

---

## 6. Stop point

Per the Phase 3.1 instruction, work stops after presenting this audit.
**Phase 4 (Conversations) is not started.**
