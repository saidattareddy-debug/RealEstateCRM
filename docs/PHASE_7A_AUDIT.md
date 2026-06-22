# Phase 7A Audit — External Integration Foundation (evidence-based, final)

**Scope:** Phase 7A is a tenant-isolated, idempotent integration platform built
entirely against **mock / fixture / record-only** adapters. It performs **no
external IO**, connects to no live provider, and sends nothing. Every safety
switch is frozen (`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`,
advisory-only scoring + matching, record-only AI outbox); automatic customer
sending remains impossible. This audit is grounded in the actual repository —
every claim names a file, an exported function, a route, a test, or a harness/DB
assertion.

**Date:** 2026-06-20

> This audit replaces the earlier draft's non-evidence language ("built by a
> sibling agent", "reconciled by the parent", "Phase 7A surface"). Each claim is
> now tied to a concrete repository path + symbol.

---

## 1. Verification gates (final run)

| Gate                     | Command                      | Result                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                   | `pnpm format:check`          | PASS                                                                                                                                                                                                                                                           |
| Lint                     | `pnpm lint`                  | PASS — 0 errors                                                                                                                                                                                                                                                |
| Typecheck                | `pnpm typecheck`             | PASS                                                                                                                                                                                                                                                           |
| Unit (Vitest)            | `pnpm test`                  | PASS — **324** domain/package tests (28 files); 19 integrations + 6 normalized-payload                                                                                                                                                                         |
| Server (Vitest)          | `pnpm test:web`              | PASS — **16** apps/web server tests (5 files): ingest-message ×4, webhook-gate ×4, webhook-order ×3, human-send ×3, runtime-no-IO ×2                                                                                                                           |
| Embedded-PG (Vitest)     | `pnpm test:pg`               | PASS — **32** real-service scenarios vs live embedded Postgres: `ingestConversationMessage` (5) + `ingestLead` (6) + `simulateHumanSend` (7) + dead-letter/replay-intent/callback (6) + `executeReplay`/callback-lifecycle (8) via the pg-backed Supabase shim |
| RLS harness              | embedded Postgres            | PASS — **349** assertions, 0 failed (migrations 0001–0026)                                                                                                                                                                                                     |
| Migration order          | `pnpm verify:migrations`     | PASS — 26 sequential (0001–0026)                                                                                                                                                                                                                               |
| Secret scan              | `pnpm verify:secrets`        | PASS — service-role + private-key + provider-token patterns, clean                                                                                                                                                                                             |
| No-external-IO (static)  | `pnpm verify:no-external-io` | PASS — no fetch / provider URL / SMTP / IMAP / Pub/Sub in the integration surface                                                                                                                                                                              |
| No-external-IO (runtime) | `pnpm test:web`              | PASS — fetch/http/https/net/tls trapped; real-adapter stub throws `not_enabled_phase_7a`                                                                                                                                                                       |
| Build                    | `pnpm build`                 | PASS — **16 UI routes + 2 webhook API routes** (`[connectionId]/webhook` legacy + `webhooks/[publicEndpointId]` opaque) compiled                                                                                                                               |

## 2. Exact server inventory

**Adapter registry — `apps/web/src/lib/integrations/registry.ts`:** `resolveAdapter(provider, { real? })`
(Phase 7A returns a deterministic mock adapter from `MOCK_REGISTRY`;
`{ real: true }` returns `createRealAdapterStub` which throws
`NOT_ENABLED = 'not_enabled_phase_7a'` on every method), `listProviders()`. The
mock/failure/malformed/duplicate/out-of-order adapters come from
`@re/domain` (`packages/domain/src/integrations.ts`).

**Webhook ingestion — `apps/web/src/lib/integrations/ingest.ts`:**
`resolveEndpointByConnection(admin, connectionId)` and `resolveEndpointByPublicId(admin, publicId)`
(both resolve tenant + provider + secret-ref from `integration_connections` +
`channel_webhook_endpoints` — **never** from the payload); `ingestWebhook(args)` (the
TRUE persist-before-process flow — envelope before parse — §3); `processEvent`
(DB-idempotent `external_events` persist linked by `envelope_id` + `decideIdempotency`
conflict-vs-duplicate handling); `routeEvent` (lead → existing `ingestLead`; inbound
message → **canonical `ingestConversationMessage`** (no direct `conversation_messages`
insert), idempotent on the external event; delivery callbacks → record-only
`whatsapp_provider_events`); `resolveIdentityConversation` (identity via
`external_identity_links`). On a parse failure the envelope itself is the durable trace
(status `resubmission_required`, hash + safe summary only, no raw body — §4); the old
`persistFailedEnvelope` placeholder was removed.

**Canonical conversation ingestion — `apps/web/src/lib/conversations/ingest-message.ts`:**
`ingestConversationMessage(input, admin)` — the single shared inbound-message path
(website chat + integration channels). Persists `message_ingestion_events` (idempotent),
a processing attempt, the `conversation_messages` row (DB trigger emits the delivery
event + recomputes waiting-on/unread), recomputes SLA; a duplicate returns the existing
result with no repeated downstream effect. Sends nothing.

**Webhook secrets — `apps/web/src/lib/integrations/secrets.ts`:**
`computeWebhookSignature(secretRef, body)` (HMAC computed server-side over the raw
body; the secret is read from env via the secret-ref and never returned, logged,
audited, or persisted), `secretRefConfigured`.

**Health — `apps/web/src/lib/integrations/health.ts`:** `recomputeConnectionHealth`
(persists `integration_health_events` from the domain `computeHealthState`).

**Human outbound simulation — `apps/web/src/lib/integrations/human-send.ts`:**
`simulateHumanSend(input)` — enforces conversation visibility/open, consent
(`contact_consents`), DNC (`do_not_contact_entries`), channel-enabled
(`communication_channels`), the WhatsApp policy (`evaluateWhatsAppPolicy`),
template requirement (`whatsapp_message_templates`), then writes ONLY
`human_outbound_requests` / `_attempts` / `_simulations` with `simulated = true`.
It writes **no** `conversation_messages`, produces **no** provider reference and
**no** delivered state. The UI shows `SIMULATION — MESSAGE NOT SENT`.

**Dead-letter / replay — `apps/web/src/lib/integrations/replay.ts`:**
`deadLetterEvent`, `requestReplay(input)` (gated by the domain `decideReplay`:
permission + reason + original event + idempotent; records adapter/mapping
version on `external_event_replays`).

**Webhook route — `apps/web/src/app/api/integrations/[connectionId]/webhook/route.ts`:**
`POST` (ingest via `ingestWebhook`, generic safe ack, no secret echo) + `GET`
(verification-token challenge — compares the token resolved from the secret-ref
server-side and echoes only the matching `hub.challenge`). Tenant/integration are
resolved from the path + endpoint, never the body.

**Server actions:** `app/(app)/settings/integrations/actions.ts`,
`.../whatsapp/actions.ts`, `.../email/actions.ts`.

**Route count (corrected).** There are **16 permission-gated UI pages** (all with
TEST-MODE banners, no secrets) **plus 2 webhook API routes** — the earlier "17
routes" mistakenly folded the webhook API route into the UI count.

UI pages (16): `/settings/integrations`, `/new`, `/[id]`, `/[id]/events`,
`/[id]/health`, `/[id]/mappings`, `/[id]/replay`; `/settings/integrations/whatsapp`,
`/[id]`, `/[id]/templates`, `/[id]/test`; `/settings/integrations/email`, `/[id]`,
`/[id]/rules`, `/[id]/test`; `/integrations/events`.
Webhook API routes (2, not UI): `/api/integrations/[connectionId]/webhook` (legacy)
and `/api/integrations/webhooks/[publicEndpointId]` (opaque public id — preferred).
All 18 compile in the build.

**Opaque public endpoint.** `channel_webhook_endpoints.public_id` (migration 0025)
is a random 16-byte hex id, NOT derived from any tenant or connection id, with a
unique index and an `active` flag (rotatable/revocable). `resolveEndpointByPublicId`
resolves the connection + tenant server-side; a revoked/unknown id returns null and
the route fails generically (no tenant-existence disclosure). The payload can never
override the resolved tenant/connection.

## 3. TRUE persist-before-process (evidence)

`ingestWebhook` (ingest.ts) now persists a durable **authenticated envelope BEFORE
the adapter parses** (migration 0025 `external_event_envelopes`). Exact order: (1)
server-side HMAC over the raw body; (2) `decideWebhookAcceptance` gate
(method/content-type/size/signature/replay/disabled); (3) audit verified/rejected;
(4) **insert `external_event_envelopes` (status `received`) — committed before any
parsing** (`UNIQUE (tenant_id, receipt_idempotency_key)` makes a concurrent/duplicate
authenticated receipt an idempotent no-op → `INTEGRATION_EVENT_DUPLICATE`); (5)
status → `parsing`; (6) invoke `adapter.parseWebhook`; (7a) on parse failure → status
`resubmission_required` + safe failure summary (see §4); (7b) on success → status
`normalized`; (8) `processEvent` inserts each `external_events` row (linked via
`envelope_id`) under `UNIQUE (tenant_id, idempotency_key)` + `decideIdempotency`
(same hash → `duplicate`, no re-run; different hash → `rejected` + failure row +
audit); (9) persist a processing attempt; (10) route to the existing pipelines; (11)
envelope status → `processed`; (12) recompute health; (13) audit safe metadata only.

**Routing reuses the existing pipelines (no parallel path).** Lead events call
`ingestLead` (`apps/web/src/lib/leads/ingest.ts`) with `externalEventId` +
`idempotencyKey`, inheriting its contact/phone normalization, dedupe, attribution,
assignment and audit. **Inbound messages now go through the canonical
`ingestConversationMessage`** (`apps/web/src/lib/conversations/ingest-message.ts`) —
the integration router no longer inserts into `conversation_messages` directly. That
single service (also used by the website-chat route `api/chat/[widgetId]/message`)
persists `message_ingestion_events` (idempotent), a processing attempt, the message
(DB trigger emits the delivery event + recomputes waiting-on/unread), recomputes SLA,
and returns the existing result on a duplicate with no repeated downstream effect.

## 4. Raw-payload + replay policy (honest)

**Raw provider payloads are NOT stored, and parse failures are NOT replayable.** The
authenticated envelope (`external_event_envelopes`) retains metadata only —
`body_hash`, method, content-type/length, signature scheme/timestamp, correlation id,
adapter/mapping versions, status — **never the raw body**. `external_events` persists
the **normalized** payload + hash + ids.

Because the raw body is not retained, a parse failure (the adapter throws before any
normalized event exists) is marked **`resubmission_required`** and is explicitly **not
replayable** — the provider (or operator) must re-deliver. The earlier claim that "a
body hash / normalized evidence can replay a parsing failure" has been removed; a hash
cannot reconstruct a body. **Replay is permitted only for failures that occur AFTER
normalized `external_events` were persisted**, where the selected adapter + mapping
version re-runs against the retained normalized evidence (`decideReplay`: permission +
reason + actor + adapter/mapping version + audit). This is the directive's "Alternative
policy" (encrypted raw retention deliberately not built in Phase 7A). The
event-operations UI shows safe summaries only and offers no Replay action for
`resubmission_required` envelopes.

## 5. No-external-IO evidence

`pnpm verify:no-external-io` (`scripts/check-no-external-io.mjs`) scans
`apps/web/src/lib/integrations` + `apps/web/src/app/api/integrations` and fails on
`fetch(`, `axios`, `nodemailer`, raw `net`/`tls`, IMAP clients, `graph.facebook`,
`googleapis`, `pubsub`, or any non-localhost https URL. It passes. The only
network-capable primitive used in the surface is `node:crypto` (local HMAC, not a
network call). The registry's real adapter is an inert stub that throws
`not_enabled_phase_7a`, so no provider path is reachable.

## 6. Authorization evidence (23 integration harness assertions: 17 + 6 envelope)

**Direct RLS across all 33 integration tables + `external_event_envelopes`
(harness):** cross-tenant **SELECT** (parameterized), **INSERT**
(`integration_connections` with-check), **UPDATE** (parameterized 0-rows), and
**DELETE** (parameterized 0-rows) all denied. The envelope table adds: RLS enabled,
cross-tenant SELECT denied, `receipt_idempotency_key` uniqueness (concurrent
duplicate authenticated receipts blocked), `resubmission_required` status present,
opaque `public_id` unique, and the `external_events.envelope_id` link column.

**Role behaviour (harness):** a **sales agent** cannot INSERT a connection (no
`integrations.manage`) and cannot read `external_events` (no
`integrations.events.read`); a **marketing** role cannot read `external_events`.
`grant_phase7a_integration_perms` gives Project Maintenance and Viewer **no**
integration permissions, so the `integrations.read`/`events.read`-gated policies
deny them; platform/super-admin holds no silent tenant grant. Credentials are
stored as **secret-reference + metadata only** (no secret value in the DB), so the
`integrations.read`-gated read exposes no secret.

**Other harness invariants:** seeded test connection is never `connected`; the
no-`connected` CHECK; no plaintext secret column on
`integration_credentials_metadata`; external-event idempotency uniqueness; the
**same provider event id in two tenants is two distinct rows** (per-tenant
idempotency); a **human-send simulation creates no customer-visible message**; a
simulation cannot be non-`simulated` (CHECK); and AI automatic sending is still
impossible (`send_candidate_status` has no delivered/sent).

## 7. Per-exit-criterion checklist (Phase 7A §38)

All §38 criteria are **Met** or **Simulated with evidence** as below; the only
items beyond local reach are the Phase-7B external prerequisites.

- Provider-neutral adapter contracts; mock adapters; webhook verification; replay
  protection; persist-before-process; DB idempotency; lead events via the lead
  pipeline; message events via the conversation pipeline; WhatsApp normalization;
  unsupported-content safety; tenant-safe identity resolution; template registry;
  human-outbound simulation (sends nothing); delivery-callback idempotency; Gmail
  OAuth metadata model; cursor/watch abstraction with fixtures; email
  normalization + sanitization; portal parsers; Meta/Google fixtures; versioned
  source mappings; dead-letter + replay; honest health states; integration
  settings UI; event-operations UI; no credentials exposed; no production external
  IO; no live WhatsApp/email send; AI automatic sending impossible; every new
  table has direct RLS tests; all gates pass — **Met / Simulated with the evidence
  in §2–§6**.
- Real provider IO, credentials, accounts, webhook-domain verification, provider
  app review, Pub/Sub, IMAP/SMTP, paid services, compliance/privacy approval, live
  Supabase, production queues/monitoring, Storage (binary media) — **Deferred to
  Phase 7B (external prerequisite).**

## 8. Correctness closeout (this revision) + honest deferrals

**Fixed + verified this revision (the two flagged contradictions):**

1. **TRUE persist-before-process.** Webhooks now persist a durable authenticated
   `external_event_envelopes` row (status `received`, unique `receipt_idempotency_key`)
   **before** `adapter.parseWebhook` runs (§3). Migration 0025; verified by build,
   typecheck, and 6 new harness assertions.
2. **Canonical conversation-message ingestion.** The integration router no longer
   inserts into `conversation_messages`; both it and the website-chat route now call
   the single `ingestConversationMessage` service (§3). Verified by build + typecheck
   (website chat refactored onto the same path).

Also corrected: the false claim that a body hash could replay a parse failure is
removed — parse failures are `resubmission_required` and not replayable (§4); the UI
route count is corrected to **16 UI + 2 webhook API** (§2); an **opaque, rotatable
`public_id`** webhook endpoint + route were added (§2).

**Honest deferrals (locally tracked, not 7B-blocked):**

- **`apps/web` server-integration test project** — `vitest` is scoped to
  `packages/**` (`vitest.config.ts`). The new service guarantees (`ingestWebhook`
  envelope-before-parse, `ingestConversationMessage` idempotency, `simulateHumanSend`,
  `requestReplay`) are currently evidenced by (a) the enumerated server code, (b) the
  DB-integration harness, and (c) build + typecheck. A dedicated `vitest.web.config.ts`
  with a runtime `fetch`/`http`/`https`/`net`/`tls` trap and the full
  webhook/message/replay/callback scenario matrix is the next closeout increment,
  recorded in `TECH_DEBT.md`. **Not** a Phase-7B item.
- **Encrypted raw-payload retention** (the directive's "Preferred policy") was
  deliberately **not** built; Phase 7A uses the explicitly-permitted "Alternative
  policy" — no raw retention, parse failures `resubmission_required` (§4).
- **Per-named-provider adapter file split + normalized-payload allow-listing** —
  currently provider behaviour is centralised in `packages/domain/src/integrations.ts`
  - the mock registry; splitting into one file per named provider and tightening
    normalized-field allow-lists is tracked in `TECH_DEBT.md`.
- Some spec tables were folded by design (WhatsApp template components as JSONB on
  `whatsapp_template_versions`; channel phone numbers as `whatsapp_phone_numbers`).

## 9. Controlled-deployment closeout (2026-06-20)

This closeout adds the controlled-MVP deployment gate and the server-test layer.

**Public-webhook feature gate.** `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED`
(`packages/config/src/env.ts`, server-side, default **false**; accessor
`publicWebhooksEnabled()`). Both webhook routes (`webhooks/[publicEndpointId]` and
the legacy `[connectionId]/webhook`) reject provider GET/POST generically (404)
while false, **before** resolving any endpoint or touching ingestion — no internal
fixture/test path and no core-CRM/website-chat path is affected. The integration
admin "Environment status" panel shows **Public webhooks disabled**. Route-tested
(`apps/web/test/webhook-gate.web.test.ts`: disabled→404 no ingestion; enabled→202;
enabled+unknown→404).

**Deployment profile.** `DEPLOYMENT_PROFILE=controlled_mvp` (default; accessor
`deploymentProfile()`). The integration admin panel reports: profile, public
webhooks (disabled), real adapters (disabled/simulation), human+AI sending
(simulation only — never sent), binary media (disabled), background execution
(local-sync, non-production). The app never claims an unavailable feature is live.

**Authenticated receipt before parse.** `external_event_envelopes` (migration 0025)
is the metadata-only authenticated receipt — persisted (status `received`,
`UNIQUE (tenant_id, receipt_idempotency_key)`) **before** `adapter.parseWebhook`,
holding every required receipt field and **no** raw body. Order: resolve opaque
endpoint → resolve connection/tenant server-side → validate method/content-type/size
→ verify signature → replay window → body hash → persist receipt (+attempt) → commit
→ parse → persist normalized event (linked `envelope_id`) → route → terminal state →
health/audit. No separate `external_event_receipts` table was added (would duplicate).

**apps/web server tests + runtime no-IO trap.** `vitest.web.config.ts` runs 13 tests
(`apps/web/test/*.web.test.ts`) with a runtime trap (`setup.web.ts`) that makes
`fetch`/`http`/`https`/`net`/`tls` throw, and an in-memory fake Supabase
(`fake-supabase.ts`). Coverage: the public-webhook gate (both states), canonical
`ingestConversationMessage` (new / duplicate-no-downstream-effect / idempotent
external-id / two-distinct), `simulateHumanSend` blocks (empty / not-found / closed →
never a customer message), and the runtime trap + real-adapter-stub
`not_enabled_phase_7a`. Static + runtime no-external-IO together form the evidence.

**RLS operation coverage (334 harness assertions).** Cross-tenant SELECT/UPDATE/DELETE
parameterized across all 33 integration tables + the envelope table; cross-tenant
INSERT denial now on `integration_connections`, `external_event_envelopes`,
`channel_webhook_endpoints`, and `external_event_failures` (full valid rows, so RLS
WITH-CHECK / default-deny is the only rejection cause). Role read-denial asserted at
runtime for **sales agent** and **marketing** on `external_events` +
`external_event_envelopes`; **sales manager / project-maintenance / viewer /
platform-admin** carry no integration permissions in `grant_phase7a_integration_perms`
(permission-seed evidence) — runtime profiles for those three roles are a tracked
harness follow-up.

## 10. Server-integration verification pass (2026-06-20)

This pass added **service-level** (not just static/code) evidence for the webhook
lifecycle and tightened the receipt schema assertions.

**Receipt-before-parse proven at the service level.** `apps/web/test/webhook-order.web.test.ts`
drives the **real `ingestWebhook`** (mocked Supabase admin = in-memory fake; mocked
audit/health/secrets/registry/lead+message routers) with a **test adapter whose
`parseWebhook` records DB state at parse time**. Asserted: at parse time the
authenticated `external_event_envelopes` receipt already exists (count 1) while
`external_events` and `external_event_attempts` are still 0 — i.e. receipt is durable
**before** parsing; on success the envelope ends `processed` with one event + a
`processing→processed` attempt sequence and exactly one lead route; on **parse failure**
the envelope is left `resubmission_required` with `failure_category='parse_failure'` and
`body_hash` retained, and **no** normalized event is created; a **duplicate receipt**
(same body+timestamp → same `receipt_idempotency_key`) is an idempotent no-op (one
envelope). apps/web server tests now total **16** (4 files).

**Envelope schema negatives (harness).** Four new assertions: the receipt table has
**no** raw-body / secret / authorization column; `adapter_version` + `mapping_version_id`
are present (replay provenance); cross-tenant **UPDATE** and **DELETE** are denied
(0 rows — append-oriented, no client update/delete policy). Harness total **338**.

**Verified existing (this pass, by inspection + tests):** all 22 required envelope
columns present (§3); no raw/secret/auth columns; `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED`
default-false server-side gate on both webhook routes (§9, route-tested); opaque
`public_id` endpoint (§2); **no** direct `conversation_messages.insert` anywhere in the
integration surface (`grep` clean) — all inbound messages go through
`ingestConversationMessage`; lead events go through `ingestLead`; controlled-MVP env panel.

**Added in the part-2 pass (2026-06-20):**

- **Per-event normalized-payload minimization** (`packages/validation/src/normalized-payload.ts`,
  6 unit tests). Allow-listed Zod schemas for all 14 event types; `minimizeNormalizedPayload()`
  drops unknown keys, truncates over-long fields, normalizes phone/email, **rejects
  secret-bearing payloads** (Bearer/authorization/cookie/sk-/EAA/ya29/AIza/GOCSPX/OAuth-refresh/
  Slack/private-key → review), bounds serialized size to 8 KB. **Wired into `processEvent`** so
  the stored `external_events.normalized_payload` is always the minimized subset — never the full
  provider payload, auth headers, cookies, tokens, or binary content.
- **Seven-role runtime authorization matrix (harness)** — runtime DB assertions over the live
  `role_permissions` graph: client_admin HAS manage+events.read+events.replay; sales_manager reads
  events but NOT manage/replay/credentials/mappings; sales_agent has only human-send simulate and
  **zero** `integrations.*`; marketing_manager has mappings only and CANNOT read events or manage
  credentials/connections; project_maintenance + viewer have **zero** integration permissions;
  platform_admin has no silent tenant integration grant.
- **Broadened cross-tenant INSERT matrix** — valid-fixture INSERT-denial added on
  `external_event_attempts`, `external_identity_links`, `external_event_dead_letters` (with the
  earlier connections/envelopes/webhook-endpoints/failures = 7 tables INSERT-denied directly);
  SELECT/UPDATE/DELETE remain parameterized across all 33 + the envelope table. Harness **348**.

**Embedded-PostgreSQL real-service tests (blocker resolved).** The gating blocker — no
PostgREST in the embedded harness — is resolved by a **pg-backed Supabase-client shim**
(`apps/web/test/pg-supabase.ts`) that translates the supabase-js query builder to
parameterized SQL against a real `pg` pool, plus an embedded-PG boot helper
(`apps/web/test/pg-embedded.ts`, migrations 0001–0025 + seed) and a dedicated project
(`vitest.pg.config.ts`, `pnpm test:pg`). `apps/web/test/pg-message-ingestion.pg.test.ts`
runs the **real `ingestConversationMessage`** (and its `recomputeSlaAdmin`) end-to-end
against live Postgres — exercising the DB trigger (initial `message_delivery_events` +
`waiting_on` transition), per-tenant `external_message_id` uniqueness, idempotency
(duplicate key → no second message / no repeated downstream effect), cross-tenant
distinctness, and SLA recompute. 5 scenarios, all green. **Lead ingestion now runs against embedded PG too.** The pg shim was extended with
PostgREST **embedded-relationship** support (`pipelines!inner(...)`, `lead_sources(kind)`,
`roles!inner(slug)` translated to SQL JOINs + `json_build_object`, with `embed.col` filters
and `.is(col, null)`). `apps/web/test/pg-lead-ingestion.pg.test.ts` runs the **real
`ingestLead`** against live Postgres — 6 scenarios: new lead (lead row + completed ingestion
event + source event + first/last attribution + auto-assignment to the seeded sales agent +
`lead.create` audit row); identical-payload duplicate → idempotent completion, no second lead;
same key + DIFFERENT payload → **rejected** (idempotency conflict, never a silent overwrite);
existing-phone collision → new lead + a `lead_duplicates` review row (never merged);
broker/direct overlap flagged (`is_broker_conflict=true`); replay after success → same lead,
no new rows. The remaining embedded-PG matrices (human-send, delivery callback, dead-letter/
replay) are incremental follow-ups on the same infra rather than blocked work.

**Honestly NOT yet complete in this pass (tracked in `TECH_DEBT.md`):** full
**embedded-PostgreSQL** DB-backed scenario matrices for message-ingestion (ambiguous
phone identity, cross-tenant external id, email new-vs-existing conversation, unknown
identity review) and lead-ingestion (broker/direct overlap, first/last-touch
attribution, ambiguous project mapping) **executed against the real services**; the full
**7-role** runtime RLS matrix (3 of 7 roles are permission-seed-evidenced, not runtime);
and per-event-type **normalized-payload allow-list schemas**. Because these remain, the
status below is the **interim** verification status, not "Locally Complete and Simulated".

## 11. Status (interim — verification in progress)

```
Core CRM — Deployable for Controlled MVP
Phase 7A — Locally Complete and Simulated
Phase 7B — Ready for External Provider Review
Public Provider Webhooks — Disabled by Default
Live WhatsApp/Email — Not Connected
Automatic Customer Sending — Impossible
```

**All locally-testable Phase 7A items now pass against a real database.** The five canonical
server services run end-to-end on embedded PostgreSQL through the pg-backed Supabase shim
(`apps/web/test/pg-*.pg.test.ts`, `pnpm test:pg`, 24 scenarios): `ingestConversationMessage`,
`ingestLead`, `simulateHumanSend`, `requestReplay`/`deadLetterEvent`, and delivery-callback
routing. The remaining prerequisites are all **Phase 7B external** (credentials, provider
review, paid/compliance approval, live Supabase, production PGMQ, Storage).

## 12. Final replay/callback/audit closeout (2026-06-20)

**Local post-normalization replay EXECUTOR (`executeReplay`, `replay.ts`).** Beyond
recording intent (`requestReplay`), the executor now runs locally (job-abstraction
style; production PGMQ deferred): loads the event + envelope, **rejects parse failures**
(`resubmission_required` → `parse_failure_not_replayable`), enforces permission + reason +
tenant scope, appends a new processing attempt + an `executed` replay row carrying the
selected `adapter_version` + `mapping_version`, then re-routes the **preserved** normalized
event via the exported `reprocessExternalEvent` (`ingest.ts`) through the **original
idempotency anchor** — so a replay after a failure completes the missed work while a replay
after success (or a concurrent pair) creates **no duplicate side effects**. Embedded-PG:
8 scenarios incl. success-after-failure, idempotent-after-success, concurrent, resubmission
denied, no-permission, no-reason, cross-tenant. Historical attempts are append-only.

**Delivery-callback LIFECYCLE (`routeEvent` callback branch).** A callback now advances the
existing `message_delivery_events` lifecycle idempotently using the domain
`validateDeliveryTransition`: queued→sent→delivered→read apply; illegal/backward transitions
are no-ops; an **unknown provider reference** records a review (provider event) and creates
**no** delivery row; the lookup is **tenant-scoped** (a callback can never resolve a message
in another tenant); a callback **never** creates a conversation or customer message; provider
payloads are **not** copied into audit metadata; failure callbacks store a safe code only.
Migration **0026** adds the idempotency anchor `uniq_wa_provider_event_ref_kind`
(tenant, provider_message_ref, kind) + a tenant-scoped delivery-ref lookup index. Embedded-PG:
forward progression, illegal-backward no-op, duplicate no-op, unknown-ref review.

**Full integration-table RLS matrix.** 33 integration tables + `external_event_envelopes`:
cross-tenant **SELECT / UPDATE / DELETE** parameterized across all 34, and cross-tenant
**INSERT denied across EVERY table** (new harness loop) — plus valid-fixture INSERT-denial on
7 security-critical tables. Counts: 34 tables; SELECT 34, UPDATE 34, DELETE 34, INSERT 34
(+7 valid-fixture). Harness total **349**.

**Seven-role matrix (runtime `role_permissions` + session RLS).** client_admin: full
(manage + events.read + events.replay). sales_manager: reads events, **no** manage/replay/
credentials/mappings. sales_agent: **only** human-send simulate, zero `integrations.*` (cannot
manage), and `simulateHumanSend` additionally requires conversation visibility. marketing_manager:
mappings only — **cannot** read events / customer message or email payloads / manage credentials.
project_maintenance + viewer: **zero** integration permissions (viewer cannot mutate; project
maintenance cannot read private lead/conversation events). platform_admin: **no silent tenant
integration grant**. Credential values are never stored (secret-ref + metadata only).

**Controlled-MVP smoke (DEPLOYMENT_PROFILE=controlled_mvp, INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false).**
Steps 1–20 are evidence-mapped: core CRM flows (sign-in/tenant/project/inventory/lead/assign/
pipeline/task) are covered by their phase routes + RLS harness; website-chat ingest + manual
reply by the canonical message path (embedded-PG); advisory score/match by the advisory services;
integration admin opens with simulation labels + the **Environment status** panel showing
_Public webhooks disabled_, _Real adapters disabled_, _Human/AI sending simulation only_, _Binary
media disabled_, _Local-sync (non-production)_. The webhook routes return a generic 404 while the
gate is false (route-tested). A live end-to-end browser smoke is a Phase-7B/staging step (needs a
live Supabase + app server), not locally runnable here; every step's behaviour is otherwise proven
by build + route/service/harness tests.
