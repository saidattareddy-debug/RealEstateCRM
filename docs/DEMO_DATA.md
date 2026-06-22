# Demo Data Generator (controlled-MVP / STAGING only)

A safe, deterministic, idempotent, reversible generator that populates the
**Northwind Estates** staging tenant with clearly-synthetic demo data so the CRM
can be demonstrated end to end. It is CLI-only and **never** runs against
production, never enables live providers/webhooks/sends, and never performs any
external network IO.

> Dataset id: `controlled-mvp-demo-v1`
> Synthetic email domain: `@northwind-demo.example`
> Synthetic phone block: `+91 99999 9XXXXX` (valid E.164, reserved as fake; every
> generated row is recorded in the ledger)

---

## 1. Safety — the generator REFUSES unless ALL of these hold

The gate (`scripts/demo/safety.mjs`) is pure and unit-tested. It runs **before any
database client is even imported**, so a refusal opens no connection.

| Condition                             | Required value                             |
| ------------------------------------- | ------------------------------------------ |
| `ALLOW_DEMO_DATA_SEED`                | `true`                                     |
| `DEPLOYMENT_PROFILE`                  | `controlled_mvp`                           |
| `NODE_ENV`                            | not `production`                           |
| `APP_ENV`                             | not `production`                           |
| `ENVIRONMENT_NAME`                    | not `production`                           |
| `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED` | `false`                                    |
| `LIVE_SEND_MASTER_SWITCH`             | `false`                                    |
| `RESPONDER_LIVE_SENDING`              | `false`                                    |
| `DEMO_SEED_CONFIRMATION`              | `I_UNDERSTAND_THIS_CREATES_SYNTHETIC_DATA` |

It also refuses:

- a Supabase project ref listed in `DEMO_BLOCKED_PROJECT_REFS` (comma separated),
- a Supabase host or `APP_URL` host that looks production-like
  (`prod`, `production`, `live`, `app.northwind`, `crm.northwind`),
- any **write** without `--confirm` (use `--dry-run` to preview).

These switches are **preserved**, never flipped: `DEPLOYMENT_PROFILE=controlled_mvp`,
`INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false`, `LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`.

---

## 2. Commands

```bash
# Preview the plan, write nothing:
pnpm demo:seed   --tenant northwind-estates --dry-run

# Seed (writes), after reviewing the printed plan:
pnpm demo:seed   --tenant northwind-estates --confirm

# Inspect what was seeded:
pnpm demo:status --tenant northwind-estates

# Remove ONLY this run's demo data (ledger-driven, FK-safe):
pnpm demo:reset  --tenant northwind-estates --confirm
```

Options: `--tenant <slug>`, `--admin-email <email>`, `--dataset-version <id>`,
`--create-tenant`, `--confirm`, `--dry-run`.

Before any write the generator prints the target Supabase **host only** (never the
URL secret or the service-role key), the tenant, and the row plan.

### Required environment (staging)

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging service-role key>"   # server-only, never printed
export ALLOW_DEMO_DATA_SEED=true
export DEPLOYMENT_PROFILE=controlled_mvp
export DEMO_SEED_CONFIRMATION=I_UNDERSTAND_THIS_CREATES_SYNTHETIC_DATA
# (the live/webhook switches default to false and must stay false)
```

The exact operator command, after reviewing the dry-run, is:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key> \
ALLOW_DEMO_DATA_SEED=true DEPLOYMENT_PROFILE=controlled_mvp \
DEMO_SEED_CONFIRMATION=I_UNDERSTAND_THIS_CREATES_SYNTHETIC_DATA \
pnpm demo:seed --tenant northwind-estates --confirm
```

---

## 3. Tenant

Targets the existing seed tenant **Northwind Estates**
(`id 11111111-1111-1111-1111-111111111111`, slug `northwind`). The generator
resolves by **id** and accepts either slug (`northwind` or `northwind-estates`).
If the tenant is missing it stops with a clear message (pass `--create-tenant`
to override — tenant creation itself is intentionally left to the operator).

---

## 4. What gets generated

| Domain           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | How                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Projects         | 3 (Verdant Grove — premium/approved; Cedar Heights — mid-premium/approved; Lakeview Courtyard — DRAFT/pending) with configs, amenities, offers, FAQs, media + documents (`.example` URLs only)                                                                                                                                                                                                                                                                                                                                                                          | service-role insert                                                        |
| Inventory        | ~48 units: 20 available+fresh, 6 available+stale, 5 on-hold, 5 reserved, 4 booked, 4 sold, 4 unavailable; price + status history written automatically by the existing unit trigger                                                                                                                                                                                                                                                                                                                                                                                     | service-role insert                                                        |
| Leads            | ~40 via the canonical `ingestLead` — full source/stage spread + edge cases (exact/probable dups, broker overlap, missing budget, DNC, unassigned)                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/web/src/lib/leads/ingest.ts`                                         |
| Preferences/tags | budget/config/location/purpose + tags (Hot/Follow up/Investor — never used to set scoring class)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | service-role insert                                                        |
| Tasks            | ~25: 5 overdue, 6 due today, 8 upcoming, 4 done, 2 unassigned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | service-role insert                                                        |
| Scoring          | observations + **real** score runs (hot/warm/cold/review spread)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `scoring/observations.ts` + `scoring/score-service.ts` — **advisory only** |
| Matching         | **real** match runs for a representative subset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `matching/match-service.ts` — **advisory only**                            |
| Conversations    | ~15 conversations / ~51 messages across website / WhatsApp-fixture / email-fixture / manual(voice) channels. State spread: waiting-for-agent, waiting-for-customer, human takeover, open, closed, reopened, needs-response, SLA warning, SLA breached, DNC blocked, consent withdrawn, unassigned. Inbound (lead) messages flow through the canonical ingestion service; agent/system replies, takeover, status, assignment-transfer, deterministic summaries, consent/DNC are written service-role. **No `ai` message; `ai_active=false` on every demo conversation.** | `apps/web/src/lib/conversations/ingest-message.ts`                         |
| Consent / DNC    | 2 consent states (revoked / do-not-contact) + 2 consent events + 1 active DNC entry (§12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | service-role insert                                                        |
| Knowledge        | 10 docs — 9 **approved/active** (approved-by demo admin), 1 Lakeview **PENDING APPROVAL / not sale-ready** (stays `review_required`); ~46 chunks; **mock embeddings** (`development=true`, `mock-embed-v1`). Docs: Verdant overview/pricing/amenities; Cedar overview; Lakeview pending; Sales FAQ (21 Q/A); Site-Visit Process; Payment/Booking; Responsible-AI Sales Policy; Demo Data Disclaimer                                                                                                                                                                     | `apps/web/src/lib/ai/ingestion.ts`                                         |
| Knowledge eval   | A deterministic **23-question** eval set in the AI evaluation framework (`ai_evaluation_datasets`/`_cases`) carrying the §15 safety expectations (cite a synthetic Approved source, label pricing indicative, never guarantee availability, travel-time unknown, escalate approval uncertainty, respect DNC/consent, never auto-send)                                                                                                                                                                                                                                   | service-role insert into the existing eval tables                          |

Scoring and matching are **advisory**: they never change a lead's stage, status,
assignment, or reserve inventory. Leads always flow through `ingestLead`
(persist-before-process, idempotent). Conversation inbound messages flow through
the canonical `ingestConversationMessage`; knowledge docs flow through the
canonical `ingestKnowledge` (then approved-state is applied service-role).
**No conversation/AI message is ever sent, and the AI responder gate stays off
(`ai_active=false`).** Embeddings are **mock only** (no external provider call).

### Profiles / Auth users

The generator does **not** create Supabase Auth users or synthetic `profiles`
rows by default (`profiles.id` references `auth.users`). Lead/task assignments
attach to the **existing seeded staging profiles** (admin / sales agent /
marketing). Creating real Auth accounts for the seven demo roles is a separate,
explicit step performed in the Supabase dashboard (invite emails OFF); it is not
automated here so the generator never sends an email or provisions credentials.

---

## 5. Idempotency & reversibility (migration `0028_demo_seed_runs.sql`)

Two tenant-scoped, default-deny, RLS-protected bookkeeping tables — added with no
demo-only columns on any production table:

- `demo_seed_runs` — one row per generator invocation (status, counts,
  correlation id). A deterministic `run_id` per (tenant, dataset) means a re-seed
  finds and reuses the same run.
- `demo_seed_entities` — one row per synthetic entity (type, id, external ref),
  enabling exact, FK-safe teardown.

Every generated row uses a **deterministic UUID** derived from
`(dataset, tenant, kind, key)`. Running `demo:seed` twice does not duplicate
anything (the second run detects existing rows + the existing run and skips;
append-only score/match runs are produced on the first seed only).

`demo:reset` deletes **only** the ids recorded in `demo_seed_entities` for the
selected `(tenant, run_id)`, in FK-safe order, then marks the run `reverted`.
Unrelated tenant data and the original `supabase/seed/seed.sql` rows are never
touched.

Read access to the ledger requires the `demo.data.manage` permission (granted to
the per-tenant `client_admin` role). Writes happen only via the service-role
admin client.

---

## 6. Audit events

The generator emits (metadata = tenant, dataset_version, section, counts,
correlation_id — never secrets/tokens/message bodies/payloads):

`demo.seed.started` · `demo.seed.section_completed` · `demo.seed.completed` ·
`demo.seed.failed` · `demo.reset.started` · `demo.reset.completed` ·
`demo.reset.failed`

These action keys are registered in migration `0028` (`audit_actions`).

---

## 7. Verification (local, embedded Postgres)

The full canonical path is exercised by the embedded-PG test
`apps/web/test/pg-demo-seed.pg.test.ts` (boots Postgres, applies migrations
0001–0028 + seed, runs the REAL `ingestLead` / `recordObservation` /
`runLeadScore` / `runLeadMatch` / `ingestConversationMessage` / `ingestKnowledge`
through the single `runSeed` orchestrator):

- dry-run writes nothing (projects/conversations/knowledge plan counts computed,
  zero rows written),
- first seed creates the data,
- **conversations** are seeded via the canonical ingestion service with **NO
  auto-AI message** (`sender='ai'` count is 0, `ai_active=false` on every demo
  conversation) and the full state/consent/DNC spread is present,
- **knowledge** docs are approved/active (Lakeview stays `review_required`), all
  embeddings are **mock** (`development=true`, `mock-embed-v1`), and the lexical
  retrieval path surfaces the expected approved amenities chunk (never the
  pending Lakeview doc),
- the **≥20-question eval set** is present with the §15 safety expectations,
- scoring/matching are advisory-only, inventory availability is accurate,
- a second seed is idempotent (conversation/message/knowledge/chunk/embedding/
  eval counts unchanged),
- reset removes only this run's demo rows (conversations + cascaded
  messages/events/summaries, consent/DNC, knowledge sources + cascaded
  chunks/embeddings/versions, the demo eval dataset + cases) while preserving
  unrelated control conversation/knowledge rows and the original seed rows.

Pure safety/idempotency-keying tests live in
`apps/web/test/demo-safety.web.test.ts` (production refusal, missing
acknowledgement, webhooks-enabled refusal, live-send refusal, no-confirm refusal,
deterministic-id stability).

### Expected app states after a seed

- **Dashboard / Inbox**: ~15 conversations across the inbox with the state spread
  above — an unassigned thread, a human-takeover thread, SLA warning/breached
  chips, a DNC-blocked thread (outbound disabled), closed + reopened threads.
- **Knowledge**: 9 approved/active sources visible; the Lakeview source shows as
  pending/`review_required` and is excluded from grounded answers.
- **AI Test Lab**: the "Demo Knowledge Eval" dataset (23 cases) is available to
  run; pending-approval and out-of-scope questions expect escalation (no draft).

---

## 8. Limitations (honest)

- The dataset now covers projects, configs, inventory, leads, preferences, tags,
  tasks, scoring, matching, **conversations + consent/DNC**, and **knowledge +
  mock embeddings + a knowledge eval set**.
- The CLI seeds the **service-role sections** directly; **leads, scoring,
  matching, conversation inbound messages and knowledge ingestion** run through
  the canonical TypeScript services, which are wired into the same `runSeed`
  function and fully verified by the embedded-PG harness. When the canonical
  services are not available to the plain-Node CLI runtime, those sections are
  skipped with a clear message — the verified path for them is the embedded-PG
  test and (on a normal dev machine) a compiled bridge.
- **Embeddings are mock only** (`development=true`, `mock-embed-v1`); no external
  embedding provider is called. Vector ANN retrieval is exercised in production
  via pgvector; the embedded-PG harness verifies the deterministic lexical
  retrieval path (pgvector is disabled in the embedded test engine).
- **No AI auto-reply** is ever produced: every demo conversation has
  `ai_active=false`, the responder gate stays off, and no message carries the
  `ai` sender.
- No `/settings/demo-data` admin page is shipped: a service-role generator does
  not belong in the browser, so this stays CLI-only by design.
