# Deployment

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §3, §28–29, §33. Web app on Vercel; data/auth/storage/functions on Supabase. Three environments: **local**, **staging**, **production**. This document is the operational runbook skeleton; concrete commands are finalized in Phase 1 when the repo and lockfile exist.

---

## 1. Environments

| Environment | Web                            | Supabase                                                                | Purpose                      |
| ----------- | ------------------------------ | ----------------------------------------------------------------------- | ---------------------------- |
| Local       | `next dev`                     | Supabase CLI local stack                                                | Development, fast iteration  |
| Staging     | Vercel preview/staging project | Dedicated staging Supabase project                                      | Integration testing, QA, E2E |
| Production  | Vercel production              | Production Supabase project (shared) or dedicated per enterprise tenant | Live                         |

**Deployment modes** ([`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.4): _shared_ (one Supabase for many tenants) and _dedicated enterprise_ (env-selected dedicated Supabase/domain). Same code; selection via `packages/config` env validation.

## 2. Local development (Phase 1 deliverable)

1. Install toolchain: Node (pinned), `pnpm`, Supabase CLI.
2. `pnpm install` (exact versions from lockfile).
3. `supabase start` — local Postgres + Auth + Storage + Edge runtime.
4. Apply migrations + seed: `supabase db reset` (runs `supabase/migrations` then `supabase/seed`).
5. Copy `.env.example` → `.env.local`; fill non-secret local values (validated at boot).
6. `pnpm dev` — runs `apps/web`.

## 3. Environment variables

A committed `.env.example` documents every variable; `packages/config` validates them with Zod at startup and **fails fast** on missing/invalid values. Categories:

- **Public (client-safe):** Supabase URL + anon key, app URL, deployment mode.
- **Server-only secrets:** Supabase service-role key, AI provider keys (Anthropic/OpenAI/Gemini), WhatsApp tokens, Google OAuth client secret, Sentry DSN, webhook signing secrets.
- Secrets are **never** prefixed for client exposure and never imported into browser bundles ([`SECURITY.md`](./SECURITY.md) §4).

## 4. Database migrations

- Source of truth: numbered SQL files in `supabase/migrations/` (schema, RLS, functions, triggers).
- Flow: write migration → test locally (`supabase db reset` + pgTAP) → open PR → CI migration validation → apply to staging → verify → apply to production.
- Production migrations are forward-only and reviewed; destructive changes require explicit approval (a build **stop-condition**).

## 5. Seeding

`supabase/seed/` provides **synthetic** tenants/projects/inventory/leads/conversations for local and staging. Never seed production with demo data; never use real names/phones from prototypes.

## 6. CI/CD (GitHub Actions)

Pipeline: install → format check → lint → type check (strict) → unit/component tests → database tests → build → E2E (where feasible) → migration validation → dependency & secret scanning. Merges to main deploy `apps/web` to Vercel; Supabase migrations are applied via a gated job/manual approval for production.

## 7. Custom domains (white-label)

Each tenant may map a custom domain (`tenant_branding.custom_domain`). Process: add domain in Vercel → verify DNS (CNAME/A) → TLS auto-provisioned → tenant resolution middleware maps host → tenant. Documented per-tenant in the runbook; platform branding hidden in white-label mode.

## 8. Backups & restore

- Supabase automated backups enabled (point-in-time where the plan supports it).
- Documented restore procedure: provision/restore target → restore snapshot → re-point env → validate RLS + data integrity → smoke test.
- Regular restore drills on staging are recommended before relying on backups.

## 9. Rollback

- **App:** Vercel instant rollback to the previous deployment.
- **Database:** forward-fix preferred; for reversible migrations a down-path is provided; irreversible changes are gated and announced. Rollback steps recorded per release.

## 10. Release checklist

1. CI green (all layers) on the release commit.
2. Migrations reviewed, validated on staging, backup confirmed.
3. Env vars present and validated in target environment.
4. Feature flags / plan limits set correctly.
5. Integration health checks pass (WhatsApp/Gmail/Calendar where configured).
6. Smoke test of critical journeys post-deploy.
7. Sentry + health dashboard monitored after release.
8. [`BUILD_STATUS.md`](./BUILD_STATUS.md) updated.

## 11. Observability in production (§32)

Structured logs with correlation IDs; Sentry error reporting; webhook/job/AI-call logs; integration-health and queue-health checks; failed-message monitoring; alerting hooks; admin **system-health** page. Secrets and unnecessary PII are redacted from all logs.

## 11a. Phase 1.1 additions (CI, env location, official DB gate)

- **Env file location:** Next.js reads env from the **app directory** — put local values in `apps/web/.env.local` (copied from `.env.example`), not the repo root, or `NEXT_PUBLIC_*` values won't be inlined into the build/middleware.
- **GitHub Actions** (`.github/workflows/ci.yml`): three jobs — `quality` (frozen install → migration order → format → lint → typecheck → unit → build → secret scan), `database` (the **official** `supabase start` → `supabase db reset` → `supabase test db` on Docker), and `phase-1-1-gate` (fails until the official result is recorded). No secrets are in the workflow; build-time `NEXT_PUBLIC_*` are non-secret placeholders. **Required repository secrets:** none for CI; real deployment secrets (Supabase service-role, AI/WhatsApp/Google) live in the Vercel/Supabase projects only.
- **Official Supabase verification gate:** run, on a Docker-capable machine:
  ```bash
  supabase start
  supabase db reset      # applies migrations 0001..0005 + seed from a clean DB
  supabase test db       # runs the pgTAP RLS suites
  ```
  Then record the outcome in `supabase/.official-verification.json` (set the boolean fields true, add `recorded_at`, `pgtap_total`) and commit. `pnpm verify:phase-1-1` (and the CI gate job) **fail until this is recorded** — the milestone is not green on an unverified database.
- **Verification scripts:** `pnpm verify:migrations`, `pnpm verify:official-supabase`, `pnpm verify:phase-1-1`.

## Phase 5B.0 additions (record-only responder — deployment hardening)

This section adds the non-destructive deployment sequence, environment separation, the ANN performance gate, and the live-project verification plan introduced for the Phase 5B.0 record-only responder. The responder is **record-only**: a customer-visible automatic send is currently impossible by construction (see [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md)). Nothing here enables sending; it defines how migrations `0001–0020` and the future live-send path reach production safely.

### Non-destructive deployment sequence

Production must **never** be destructively reset. `supabase db reset` is destructive and is only ever run against a disposable database. The order is:

1. `supabase db reset` on a **disposable** local / CI / branch database (drops and rebuilds from migrations + seed).
2. `supabase test db` + pgTAP on that disposable database.
3. Apply (forward-only) migrations to **staging**.
4. Staging integration tests + delivery **simulations** (the simulated transports, not a real channel).
5. **Review** the generated SQL.
6. Apply forward-only migrations to **production** (never a reset; never a down-migration of live data).
7. Non-destructive **production smoke checks**.
8. Record the applied migration versions + evidence.

### Environment separation

Local, CI, staging, and production are fully separated. Each has its **own** Supabase project (or disposable DB for local/CI), its own provider credentials, its own delivery credentials, its own webhook secrets, its own allowed origins, its own rate limits, and its own audit context. **Production customer data must never be copied into local or CI fixtures** — local/CI use synthetic seed only (§5). This separation is what makes step 1 (a destructive reset) safe: a reset only ever touches a disposable database, never a project that holds real conversations.

### ANN performance gate (pgvector — do not require unconditionally)

pgvector ANN is a **performance** gate, not a correctness gate. The retrieval path is correct without an ANN index (the in-SQL / exact path used by `match_knowledge_chunks`; the embedded harness has no pgvector and uses a portable in-SQL cosine). Therefore:

- On the live project, **benchmark exact pgvector** retrieval for the chosen embedding model and corpus first.
- Add an **HNSW or IVFFlat** index **only if** measured latency/recall require it. Exact retrieval is acceptable if it meets the targets.
- If an index is added, document the index parameters, the rebuild procedure, and the rollback procedure. Index choice/params are model- and corpus-specific.

This deferral is recorded in [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md), [`PHASE_5A_AUDIT.md`](./PHASE_5A_AUDIT.md), and [`TECH_DEBT.md`](./TECH_DEBT.md).

### Live-project verification plan

- **Disposable DB:** `supabase db reset` + `supabase test db` + pgTAP + the RLS suite + the idempotency tests, all green from a clean database.
- **Staging:** apply the forward-only migration; run the sandbox / dry-run delivery transport (simulated, no real channel); run shadow traffic; exercise the queue, failure, and kill-switch tests; and perform a rollback exercise.
- **Production:** forward-only migration **only** (no reset); non-destructive smoke checks; a permission smoke; confirm the **kill switch is off**; confirm **live-send configuration is disabled** (the master switch stays false and no delivered/sent state is recordable); confirm monitoring and the audit trail are recording.

These map onto the operator checklist in [`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md) and the readiness split in [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md).

## 11A. Phase 7A → 7B activation prerequisites (external integrations)

Phase 7A ships the integration foundation as **mock / simulation / record-only**
with **no external IO** — it sends nothing, connects to no live provider, and
verifies no real webhook domain. Deploying 7A changes nothing customer-facing:
migration `0024` adds only synthetic, record-only schema, a DB
`CHECK (status <> 'connected')` keeps every connection non-live, human outbound is
`CHECK (simulated = true)`, and the frozen switches (`LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`) are untouched. It follows the same non-destructive
sequence (disposable reset → pgTAP → staging forward-only → production
forward-only + non-destructive checks).

**Live provider activation is Phase 7B**, a separate, reviewed, credentialed
change. Each prerequisite is individually fail-safe (doing one without the others
stays a no-op):

- **Tenant-supplied credentials** stored server-side (Meta WABA, Gmail/IMAP OAuth,
  portal / ad-platform access) — resolved via `secret_ref`; secrets never reach
  the browser.
- **Provider app review** (e.g. Meta) and **real webhook-domain verification** /
  endpoint registration.
- **Pub/Sub + IMAP/SMTP** wiring; **Storage** + malware scanning for binary media
  (today: provider reference only, `not_scanned`).
- **Production durable queues (PGMQ)** and **production monitoring** for
  retry/backoff/DLQ/replay execution.
- **Compliance / privacy / legal sign-off** before any live WhatsApp/email send.
- **Live Supabase verification** of migration `0024`.
- Widening the `integration_connections` no-`connected` CHECK and enabling any
  live send only after the global deployment-level **live-send master switch**
  sign-off — which remains superior to all runtime tenant/channel controls.

See [`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md) and
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md).

## 12. Phase-0 note

This runbook is intentionally tool-exact-command-light because the repository and lockfile do not yet exist (docs-only Phase 0). Phase 1 fills in exact commands, the `.env.example`, the Supabase project bootstrap, and the GitHub Actions workflow files, and this document is updated alongside.
