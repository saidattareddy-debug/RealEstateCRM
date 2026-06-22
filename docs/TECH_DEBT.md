# Technical-Debt Register

Tracked, intentional gaps and follow-ups. Each item names where it lives and what
"done" looks like. Phase audits reference this file.

## Phase 9 — Analytics & Administration (open, intentional)

- **Background metering / billing-close workers** — `usage_counters` and
  `billing_periods` are written by services on demand; done = PGMQ workers that
  meter usage continuously and close/invoice periods on a schedule.
- **Live provider health probes** — `system_health_checks` is fed deterministically
  (no network IO); done = real probes against configured providers (credentials +
  IO, a Phase-7B concern).
- **Time-series / cohort analytics** — current dashboards show the present period;
  done = historical trend + cohort charts (likely materialized rollups).
- **Live cost tracking** — AI/WhatsApp spend is metered only when a live provider is
  connected (5B.1/7B); until then `usage_counters` reflects synthetic/local usage.

## Phase 8 — Automations & Visits (open, intentional)

- **Live calendar sync** — `calendar_connections` is simulation-only
  (`status ∈ disconnected|simulated`, no OAuth/tokens). Done = Google/Outlook OAuth
  (a Phase-7B credential stop-condition) with read-only busy-block import feeding
  `detectDoubleBooking`. No network IO until then.
- **Real follow-up / notification delivery** — follow-up `send` steps and external
  (email/push) notification deliveries are recorded **suppressed/simulated**
  (`will_send=false`, `simulated=true`). Done = the 5B.1 master-switch flip + a live
  channel (7B) + an idempotent PGMQ delivery worker. The DB CHECKs make a real send
  unstorable until then.
- **Scheduled ticking workers** — `runAutomationForEvent` and `tickEnrollment` run
  synchronously via the durable-job abstraction (`SyncLocalDriver`). Done = a
  production PGMQ worker that ticks due enrollments / time-schedule automations.
- **Agent-scoped RLS for visits/automations** — current policies are tenant +
  permission scoped (an agent with `sitevisits.read` sees the tenant's visits).
  Done = per-agent visibility (e.g. `agent_id = auth.uid()` for the agent role),
  mirroring the leads assignment-scope model.

## Phase 4.1 — closed 2026-06-19 (migration 0013 + wiring)

- **Waiting-on** — DB trigger (`on_conversation_message`) persists `waiting_on`
  on every non-internal message; failed delivery flips it back to `agent`.
  Harness-verified.
- **Delivery events** — the same trigger seeds the initial
  `message_delivery_events` row (inbound `received` / outbound `queued`).
- **Message ingestion** — `/api/chat/message` now persists a
  `message_ingestion_events` row (idempotent) + a processing attempt **before**
  inserting the message; duplicates are a no-op.
- **Status / priority / transfer history** — written by the actions and now
  surfaced in the inbox "History" panel; transfer also writes
  `conversation_transfer_events` + a new `conversation_assignments` row.
- **Consent history** — DNC activation writes a `consent_events` row.
- **Summary versioning** — `generateSummary` appends a
  `conversation_summary_versions` row (`system_digest`, model/prompt null),
  superseding prior versions.
- **Base role bundles (item 14)** — migration `0014` folds the Phase-4.1
  conversation permissions into `seed_default_roles`; new tenants are provisioned
  correctly. Harness-verified on a fresh tenant.
- **Marketing metadata-only (item 13)** — the seed now includes a Marketing
  Manager user; runtime RLS proves it sees conversation rows but **not** message
  bodies or internal notes.
- **Website session security (Priority 1)** — `lib/chat/session.ts` (opaque
  token, hash-only storage, widget/tenant/conversation binding, expiry, sliding
  last-seen, rotation with previous-token invalidation, clear-chat) wired into
  `/api/chat/{start,message,clear}`; the browser supplies only the public widget
  id + opaque token. Domain `session.ts` unit-tested; harness proves scoped
  binding + modified/cross-widget/cross-tenant/expired/rotated rejection.
- **Inbox search (Priority 7)** — `searchInbox` action (RLS-first; redacted
  bodies excluded; plain-text snippets) + `buildSnippet` (domain, unit-tested) +
  search box on `/inbox`. Harness proves an agent gets no snippet from an
  inaccessible conversation; marketing metadata-only cannot read bodies.
- **SLA working-hours engine** — `packages/domain/src/sla.ts`
  (`addWorkingMinutes`, `isWithinWorkingHours`, `standardWeek`): timezone offset,
  weekday windows, overnight roll, weekend + holiday skip, closed-week fallback.
  **7 unit tests.** First-response due + status chip shown on the conversation
  detail. _Remaining: emit `conversation_sla_events`, project/channel overrides,
  list + mobile display._
- **Unread derivation** — `deriveUnread` (domain, unit-tested) + per-user
  derivation on `/inbox` (header total + per-row dot) from `conversation_reads`
  vs `last_inbound_at`. _Remaining: mobile-nav badge, website widget badge,
  visitor read-state._
- **Assignment & owner-mismatch** — `assign-actions.ts`
  (`assignConversationAction`, `setOwnerLockAction`, `resolveOwnerMismatchAction`)
  write assignment + transfer history, respect ownership lock, and never sync
  silently; `detectOwnerMismatch` (domain) drives the warning on the detail page.
  _Remaining: team assignment, availability/workload/language checks, interactive
  assign-select UI._
- **Polling transport (Priority 2)** — opaque, server-validated cursor
  (`packages/domain/src/cursor.ts`: encode/decode/compare/isAfter/merge, **5
  unit**), `ConversationTransport` interface (`lib/transport/types.ts`),
  RLS-scoped `fetchSinceAction` (redacted excluded, stable (created*at,id)
  order), `PollingTransport` client (backoff, hidden-tab reduction, dedup, safe
  resume, connection state; never claims realtime). \_Remaining: wire into the
  inbox detail to replace the static thread render.*
- **Widget runtime + install (Priority 1)** — `/widget.js` (isolated iframe,
  public-id-only, reduced-motion, keyboard), `/chat/widget/[widgetId]` (real
  session flow: start/message/poll/clear, honest states, returning-session resume,
  "not live" disclosure), `/chat/demo` (labelled dev preview), token-scoped public
  `/api/chat/[widgetId]/messages` polling endpoint, install page (snippet, status,
  active-session count, allowed domains, checklist, CSP, troubleshooting) + admin
  actions (pause/resume, revoke-all-sessions, rotate-credential). `widgetOriginAllowed`
  permits the first-party iframe.
- **Visitor read-state (Priority 3)** — migration `0015` adds
  `visitor_last_read_at` / `visitor_last_acked_message_id` to
  `website_chat_sessions`; the messages endpoint records the ack and returns the
  visitor's unread outbound count. _Remaining: surface the badge in the widget._
- **SLA policy precedence (Priority 4)** — `resolveSlaPolicy` (domain, **4 unit**;
  project+channel+priority → … → tenant default, deterministic, inactive
  excluded). _Remaining: emit `conversation_sla_events` on recompute; list/mobile
  chips._

## Phase 4.1 — completed items

_Closed 2026-06-19 (migration 0016 + final wiring). Verified: typecheck, 146 unit
tests, lint, format, build, secret scan, RLS harness 197/197._

| Area                        | Final status | Migration | Domain function                                                                                | Repository / service                                 | Server route / action                                                             | UI route / component                                                                   | Unit tests                       | RLS / DB tests                            | Integration tests                         |
| --------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Polling → inbox wiring      | Completed    | —         | `reconcileFetch`, `nextPollDelay`, `mergeNewMessages`, `encode/decodeCursor`                   | `lib/transport/polling.ts`, `types.ts`               | `inbox/transport-actions.ts` (`fetchSinceAction`, `markReadViaTransport`)         | `inbox/[id]/message-thread.tsx` (live thread, states, new-msgs ctrl)                   | polling ×13 + cursor ×5          | message RLS (harness)                     | polling reconcile/backoff scenarios (×13) |
| Visitor read semantics      | Completed    | 0015      | —                                                                                              | `lib/chat/session.ts`                                | `api/chat/[widgetId]/messages` (ack-only, unread count)                           | `chat/widget/[widgetId]/widget-client.tsx`                                             | session ×6                       | session binding/expiry/rotation ×7        | ack/unread sequence (endpoint)            |
| Unread badges               | Completed    | —         | `deriveUnread`                                                                                 | —                                                    | layout unread query                                                               | widget launcher badge (`widget.js`), mobile-nav badge, inbox totals + row dots         | deriveUnread ×3                  | —                                         | —                                         |
| SLA event emission          | Completed    | 0016      | `deriveSlaEvents`, `resolveSlaPolicy`, `addWorkingMinutes`, `computeSlaStatus`, `slaChipLabel` | `inbox/sla.ts` (`recomputeSla`, `recomputeSlaAdmin`) | wired into reply/status/priority/assignment/transfer/close/reopen + inbound route | SLA chips: inbox list, detail panel, mobile sheet                                      | sla-events ×9 + sla ×11          | sla-event kinds + provenance (harness ×2) | recompute on each trigger                 |
| Assignment UI + eligibility | Completed    | 0016      | `evaluateEligibility`, `detectOwnerMismatch`                                                   | —                                                    | `inbox/assign-actions.ts` (assign/team/lock/unassign/eligibility/owner-mismatch)  | `inbox/assign-control.tsx` (AssignControl, OwnerMismatchResolver)                      | eligibility ×10 + mismatch ×1    | teams RLS read/write ×3 (harness)         | —                                         |
| Mobile inbox                | Completed    | —         | —                                                                                              | —                                                    | (reuses inbox actions)                                                            | `inbox/[id]/mobile-sheet.tsx` (sticky safe-area action sheet) + responsive list/thread | —                                | —                                         | —                                         |
| Canned replies              | Completed    | 0016      | `resolveCannedReply` (allow-list, no HTML/JS)                                                  | —                                                    | `inbox/canned-actions.ts` (CRUD + composer list + send + usage logging)           | `settings/canned-replies/*`, `CannedPicker` in `inbox-forms.tsx`                       | resolveCannedReply (inbox suite) | canned usage RLS isolation (harness)      | server-side var resolution + enforcement  |
| Tags                        | Completed    | 0016      | —                                                                                              | —                                                    | `inbox/tag-actions.ts` (create/rename/disable/colour/bulk/list)                   | `settings/tags/*`, inbox tag filter (`inbox-views.tsx`)                                | —                                | tag RLS (harness, 0012)                   | disabled-tag-not-assignable guard         |
| Saved inbox views           | Completed    | 0016      | —                                                                                              | —                                                    | `inbox/saved-view-actions.ts` (create/list/delete/set-default)                    | `inbox/inbox-views.tsx` (views bar)                                                    | —                                | saved_views RLS (0010)                    | RLS-first apply (shared view ⇒ own rows)  |
| Widget administration       | Completed    | —         | —                                                                                              | `lib/chat/session.ts` (rotation/revoke)              | `settings/.../install/admin-actions.ts` (pause/resume/revoke-all/rotate)          | install page (status, active sessions, last rotation)                                  | —                                | session rotation/revoke (harness)         | —                                         |

Notes / approved deferrals within these items:

- **Mobile inbox** ships a purpose-built sticky, safe-area action sheet plus the
  responsive list/thread/search/filter (single-column on narrow widths); it does
  not introduce separate mobile-only _routes_. All required controls, indicators,
  and states are reachable on mobile.
- **Assignment eligibility** evaluates membership/availability/absence/team/
  language/workload/active-count/lock. Project-authorization has no dedicated
  schema yet, so it is treated as "authorised for all projects" (the domain
  function already supports a project allow-list when one exists).
- **SLA precedence** supports project+channel+priority → … → tenant default; a
  per-conversation override column is not present (precedence begins at the
  project/channel/priority tier).
- **Widget admin** surfaces last credential-rotation time + active-session count;
  a distinct "last configuration-update" timestamp is not separately displayed.

## Cross-cutting (carried)

- Official `supabase db reset` + `supabase test db` (pgTAP) on a live/Docker
  Supabase remains the authoritative DB gate — deferred (no live project).
- PGMQ execution, Realtime, Storage, production provider connectivity — deferred
  to their respective phases; interfaces exist.

## Phase 5A — Knowledge, RAG & AI Safety Foundation (2026-06-20)

**Completed & verified** (migration 0017; harness 251/251; 197 unit tests; all
gates green). Customer-facing AI answering stays OFF; automatic sending is
impossible (`evaluateAiExecution` + `ai_runs` CHECK).

Approved deferrals introduced/affirmed in 5A:

- **pgvector ANN index** — embeddings are stored as `jsonb` (model-agnostic);
  a typed `vector(N)` column + ANN index is deferred to a live project with a
  fixed embedding model. Done when: a live Supabase project + chosen model exist.
- **External chat/embedding adapters** — server-only stubs until a real provider
  credential is configured (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`);
  the deterministic mock is the default. Done when: paid-service approval +
  credentials (a Phase-5B stop-and-ask).
- **Knowledge binary upload / Supabase Storage** — disabled; only extracted text
  - metadata are stored. Done when: Supabase Storage is enabled (its phase).

Phase 4.1 approved deferrals — **still open, preserved** (do not lose):

| Item                                                                                     | Status   |
| ---------------------------------------------------------------------------------------- | -------- |
| Dedicated project-authorization schema (assignment eligibility treats projects as "all") | Deferred |
| Per-conversation SLA override (precedence begins at project+channel+priority)            | Deferred |
| Separate "last widget configuration-update" timestamp (rotation time is shown)           | Deferred |

Cross-cutting deferrals (unchanged): official `supabase db reset` + `supabase
test db` pgTAP on a live/Docker Supabase; PGMQ execution; Realtime; Storage;
production provider connectivity.

## Phase 5A — audit remediation (2026-06-20, migration 0018)

- **Canonical embeddings → in-database similarity.** `0018_embedding_pgvector.sql`
  replaces application-side jsonb-array cosine with `match_knowledge_chunks`
  (SECURITY INVOKER SQL, filters by embedding-model config + matching dimensions
  under RLS); pgvector `embedding` column + `<=>` + sync trigger are added when the
  extension is present. Embedding rows now carry model name/version, dimension,
  distance metric, checksum, mock status, created/superseded time, error state.
- **Deferred:** the pgvector `<=>` ANN index for a fixed production model
  (embedded-Postgres has no pgvector; harness exercises the portable in-SQL path).
- **Documented partials:** per-chunk retrieval results don't duplicate
  tenant/project/correlation-id (those live on the `ai_retrieval_events` run row);
  live retrieval doesn't compute claim-level conflicts inline (decision-layer
  conflict gating + `knowledge_conflicts` + `detectConflicts` are in place).

## Phase 5B.0 — record-only responder hardening (2026-06-20, migration 0020)

The responder is **record-only**; a customer-visible automatic send is impossible
by construction (compile-time `LIVE_SEND_MASTER_SWITCH = false`, no
`delivered`/`sent` candidate status, decision CHECK forbids `deliver`). See
[`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md). The following are the deferred
items that a reviewed, credentialed 5B.1 PR must address before any live send.
Each requires something external or an irreversible action and must not be done
autonomously ([`CLAUDE.md`](../CLAUDE.md) §9).

- **pgvector ANN on a live project.** The embedded harness has no pgvector and
  uses a portable in-SQL cosine. ANN is a _performance_ gate, not correctness —
  benchmark exact pgvector for the chosen model/corpus first and add HNSW/IVFFlat
  only if measured latency/recall require it. Done when: a live Supabase project +
  fixed embedding model exist and the benchmark is recorded (see
  [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md)).
- **Real PGMQ worker execution.** The durable-job abstraction lives in
  `apps/web/src/lib/jobs/` with SyncLocal/Outbox drivers; real PGMQ worker
  execution is deferred. Done when: PGMQ is provisioned and the outbox worker runs
  against it with retry/backoff/DLQ.
- **Replace the compile-time master switch with runtime enablement enforcement.**
  `LIVE_SEND_MASTER_SWITCH` is a compile-time constant today. A reviewed PR must
  replace it with per-tenant/per-channel runtime enablement (a config row +
  permission), defaulting off and auditable, so live sending is enabled
  deliberately for one tenant/channel at a time. Done when: the runtime enablement
  exists _and_ its enforcement is tested (the forged/unauthorized/cross-scope
  scenarios in [`SECURITY.md`](./SECURITY.md)).
- **Widen the delivery CHECKs.** `ai_responder_decisions`
  (`outcome in ('escalate','suppressed','blocked')`), `ai_runs`
  (`mode <> 'automatic'`), and `send_candidate_status` (no `delivered`/`sent`)
  must be widened via **new forward-only migrations** — never rewrite 0019/0020 —
  to permit a delivered/automatic path. Done when: the new migration is reviewed
  and applied alongside the master-switch flip (all together, never in isolation).
- **Provider credentials (server-only).** A real chat + embedding provider
  credential referenced by `ai_provider_configs.secret_ref`, plus a real delivery
  channel credential and callback signing secrets. Done when: credentials are
  configured server-side only and paid-service is approved (a stop-and-ask).
- **Worker-time revalidation + outbox worker wiring.** The
  `revalidateAutomaticSend` / `reconcileUncertainAttempt` contracts exist and are
  unit-tested against simulated transports; wiring them into a real worker that
  claims `ai_send_candidates`, revalidates, calls a real transport, and finalizes
  the message idempotently **after** provider acceptance is deferred (see the
  message-creation order in [`AI_DELIVERY_LIFECYCLE.md`](./AI_DELIVERY_LIFECYCLE.md)).
- **Security tests that need the worker to exist.** The worker-time fail-safe
  scenarios — kill-switch-after-queueing, DNC/consent/human-reply/takeover/close
  after generation, candidate expiry, knowledge superseded, inventory stale,
  duplicate worker, uncertain provider result, provider callback replay — are
  documented in [`SECURITY.md`](./SECURITY.md) but cannot be tested until the real
  worker is wired. Done when: the worker exists and each scenario has a passing
  test before live delivery is enabled.

Already in place and verified in 5B.0 (not debt, recorded for clarity): the
live-send domain core, the runtime/outbox schema (migration 0020), two-person
activation with the self-approval guard, the kill-switch model, the four simulated
transports, and the reconciliation contract — harness 275/275, domain unit 233.

## Phase 6A — deterministic lead scoring (2026-06-20, migration 0021)

Phase 6A scoring is **advisory / record-only** and locally complete: the pure
domain calculation, the 14-table schema with RLS, fairness enforcement in two
layers, and the per-tenant seed are in place. The following are deferred and are
recorded here, not as gaps in the advisory scoring itself.

- **Project matching — Phase 6B.** The deterministic project-matching engine
  ([`SCORING_ENGINE.md`](./SCORING_ENGINE.md) §7) is not built in 6A. Done when:
  the pure matching module + its hard-filter/ranking tests land (never returns
  Booked/Sold/Unavailable units) with their UI and review.
- **Production durable (PGMQ) recalculation execution.** Recalculation runs
  through the durable-job abstraction (`apps/web/src/lib/jobs/`) on the local-sync
  driver today; real PGMQ worker execution is deferred (shared with the 5B.0 PGMQ
  item). Done when: PGMQ is provisioned and scoring recalculation runs against it
  with retry/backoff/DLQ and idempotency.
- **Automatic actions from a score.** Automatic pipeline/stage/assignment/status
  changes driven by a score are intentionally **not** built — they belong to a
  later, explicitly-approved automation phase. The Phase 5B.1 external stop-line
  is preserved: automatic customer sending remains impossible.
- **Full rule-editor UI gaps.** The scoring settings surfaces (models, signals,
  evaluation, lead panel, `/scoring/test-lab`) exist; any remaining no-code
  rule-builder editing affordances beyond the Phase 6A surface (visual condition/
  action builder, historical simulation UI, score-distribution analytics) are
  carried forward. Done when: the remaining editor/analytics surfaces are built,
  permission-gated, and backed by real data.

## Phase 6B — deterministic project matching (2026-06-20, migration 0022)

Phase 6B matching is **advisory / record-only** and locally complete: the pure
domain calculation, the 14-table schema with RLS, two-layer fairness enforcement,
inventory safety, and the per-tenant seed are in place. The following are deferred
and are recorded here, not as gaps in the advisory matching itself.

- **Automatic actions from a match.** Automatic lead assignment / stage / status /
  score change driven by a match is intentionally **not** built — it belongs to a
  later, explicitly-approved automation phase. Matching never assigns a lead,
  changes a stage/status/score, or sends anything. Done when: that phase is
  explicitly approved and built with its own safeguards.
- **Inventory reservation / booking.** Matching never reserves, holds, or books
  inventory — reservation/booking is out of scope for matching entirely. Done
  when (if ever): a separate, explicitly-approved inventory-reservation feature is
  built; it is not part of the matching engine.
- **Production durable (PGMQ) recalculation execution.** Match recalculation runs
  through the durable-job abstraction (`apps/web/src/lib/jobs/`) on the local-sync
  driver today; real PGMQ worker execution is deferred (shared with the 5B.0/6A
  PGMQ item). Done when: PGMQ is provisioned and matching recalculation runs
  against it with retry/backoff/DLQ and idempotency.
- **Live travel-time / traffic data.** Distance/location matching uses only trusted
  stored distance facts; live travel-time/traffic integration is deferred and
  travel time is reported as **Unknown** when no trusted fact exists — never
  fabricated. Done when: a trusted travel-time source is integrated and validated.
- **Evaluation-runner UI gaps.** The matching settings surfaces and the evaluation
  dataset/cases exist; any remaining evaluation-runner UI gaps the sibling agent
  leaves are carried forward and reconciled by the parent. Done when: the remaining
  evaluation surfaces are built, permission-gated, and backed by real data.
- **AI does not determine ranking.** Project matching does **not** determine the
  final ranking from AI — AI only proposes reviewable structured preferences. This
  is a permanent design boundary, recorded here for clarity, not a deferral.
- **Any live customer sending.** Phase 5B.1 remains blocked by external approval.
  The Phase 5B.1 external stop-line is preserved: automatic customer sending
  remains impossible, and scoring and matching are advisory-only.

## Phase 6B closeout deferrals (2026-06-20)

- **Visual matching evaluation runner UI** (`/settings/matching/evaluation`) — not built; the deterministic evaluation runs as `matching-eval.test.ts` + the test lab. Planned: Phase 9. Safe fallback in place.
- **Matching model-editor UI polish** — per-field rule form grid, in-editor explanation preview, draft-bound simulate, side-by-side version comparison. The validated JSON draft editor + test lab are the fallback. Planned: Phase 9.
- **Dedicated per-agent project-authorization schema** — not present; current model is tenant-wide + RLS + lead/project-assignment scoping. Matching never bypasses it (candidate generation reads via the RLS client). Approved deferral.
- **Mock-`SupabaseClient` service test of `runLeadMatch`** — advisory-only effect is currently evidenced by enumerated write-sites + the DB harness; a mock-based unit test is a follow-up.
- **Production durable (PGMQ) match recalculation** — local-sync today.

## Phase 7A deferrals — all Phase 7B (2026-06-20)

> **Status note (superseded):** the line below originally read "Phase 7A is locally
> complete and simulated". The authoritative current status is **"Phase 7A — Server
> Integration Verification In Progress"** (see the dated pass below and
> `PHASE_7A_AUDIT.md §11`). The text in this section describes only the **Phase-7B
> external** deferrals, which are unchanged.

Phase 7A performs **no external IO** and sends nothing. The following are explicitly
**deferred to Phase 7B** (live provider activation), each individually fail-safe and
gated:

- **All real provider IO** — no live WhatsApp / Gmail / IMAP / portal / ad-platform
  connection; only deterministic mock / failure / malformed / duplicate /
  out-of-order adapters run in 7A.
- **Credentials and accounts** — no Meta WABA / Gmail OAuth / portal credentials;
  storage holds only a `secret_ref` + safe metadata (credential-blocked).
- **Webhook-domain verification & provider app review** — no real endpoint
  registration; provider-review-blocked (e.g. Meta app review).
- **Pub/Sub, IMAP/SMTP** — no mailbox watch or mail transport.
- **Storage for binary media** — WhatsApp/email media is a **provider reference
  only** (`external_reference_only`, `not_scanned`); no download or malware scan.
- **Production durable queues (PGMQ) and production monitoring** — the replay /
  retry / DLQ **decisions** are exercised, but execution uses the local-sync job
  abstraction; production queues + monitoring are deferred.
- **Live Supabase verification** — schema verified on the embedded harness only.
- **Paid services and compliance/privacy approval** — required before any live
  WhatsApp/email send (compliance-blocked).
- **Any live WhatsApp/email send** — the human-send path is **simulation-only**
  (`CHECK simulated = true`); `LIVE_SEND_MASTER_SWITCH=false` and
  `RESPONDER_LIVE_SENDING=false` remain frozen; automatic customer sending stays
  impossible.

Two spec tables were folded as design choices (noted honestly, not debt):
WhatsApp template **components** live as `jsonb` on `whatsapp_template_versions`,
and channel phone numbers as `whatsapp_phone_numbers`.

The earlier approved deferrals remain in force: per-agent project authorization,
matching evaluation-runner UI, matching model-editor polish, scoring rule-editor
polish, production PGMQ, live-Supabase verification, Storage, and Phase 5B.1. See
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md).

## Phase 7A closeout note (2026-06-20)

- **Mock-`SupabaseClient` service unit test of `ingestWebhook`/`simulateHumanSend`** — `vitest` is scoped to `packages/**`, so Phase 7A's server-level guarantees are evidenced by code enumeration (`apps/web/src/lib/integrations/*`) + the embedded-Postgres harness (idempotency, no-duplicate, human-sim creates no customer message, cross-tenant SELECT/INSERT/UPDATE/DELETE). Wiring `vitest` for `apps/web` (which uses `server-only` imports) is a small local follow-up — NOT a Phase-7B prerequisite.
- New verification gates: `pnpm verify:no-external-io` (scans the integration surface for provider/network IO) and the expanded `pnpm verify:secrets` (Meta/Google/Gmail/SMTP/HMAC/service-role/private-key/Bearer patterns).
- Raw provider payloads are **not** stored: `external_events` keeps the normalized payload + `payload_hash` + adapter/idempotency/correlation; replay re-runs the selected adapter+mapping version against preserved normalized evidence.

## Phase 7A correctness closeout (2026-06-20)

- **`apps/web` server-integration test project (next increment).** Add
  `vitest.web.config.ts` (or an embedded-PG service-test project) covering
  `ingestWebhook` (envelope-persisted-before-parse, invalid signature, disabled
  endpoint, parse/normalization/downstream failure, duplicate same/conflicting
  payload, concurrent duplicate, dead-letter, replay, replay-after-success),
  `simulateHumanSend` (permission/visibility/closed/DNC/consent/template, no
  message/delivery/provider-ref/AI mutation), `requestReplay`, and delivery-callback
  idempotency — with a runtime `fetch`/`http`/`https`/`net`/`tls` trap that fails on
  any provider IO. Currently evidenced by server code + DB harness + build/typecheck.
- **Per-named-provider adapter files + normalized-payload allow-listing.** Split the
  centralised `packages/domain/src/integrations.ts` provider logic into one module
  per named provider (WhatsApp inbound/callback/template/policy; Gmail + cursor/watch/
  gap/normalizer/thread/sanitizer/quoted-history; NoBroker/99acres/Housing/Magicbricks/
  generic; Meta/Google) and tighten `normalized_payload` to allow-listed fields.
- **Encrypted raw-payload retention** — intentionally not built (Phase 7A uses the
  no-raw-retention alternative). Revisit if replayable parse failures are required.

## Phase 7A — controlled-deployment closeout (2026-06-20): corrections

These supersede earlier wording where they conflict.

- **Database reset.** `supabase db reset` is allowed ONLY on disposable local / CI
  / database-branch environments. Production receives **forward-only** migrations
  (0001 → latest) and **non-destructive** checks (`supabase db diff`/migration-order
  validation). The authoritative live-DB gate (`db reset` + pgTAP on a Docker/live
  Supabase) remains deferred for the destructive-reset step only; forward-only
  migration application is the production path.
- **Embeddings (post-0018).** Canonical vector support EXISTS: migration 0018 adds a
  pgvector `embedding` column + `match_knowledge_chunks` (SECURITY INVOKER), scoped
  by embedding model + dimension. The embedded test harness has no pgvector and uses
  the portable in-SQL cosine fallback. ANN (HNSW/IVFFlat) is benchmark-driven and
  added only for a fixed production model. (The earlier "canonical vector support is
  absent" claim is withdrawn.)
- **Live-send switch.** The global deployment-level master switch
  (`LIVE_SEND_MASTER_SWITCH = false`) is preserved as the top-level gate. Runtime
  per-tenant/per-channel/per-project enablement controls are layered UNDERNEATH it
  (migration 0020) — they never replace the global switch; both must permit a send.
- **Public-webhook gate (new).** `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED` (server-side,
  default `false`) rejects provider webhook POSTs generically while false; internal
  fixtures and the core CRM / website-chat are unaffected. Shown in integration admin
  as "Public webhooks disabled". Route-tested (`apps/web/test/webhook-gate.web.test.ts`).
- **Deployment profile (new).** `DEPLOYMENT_PROFILE=controlled_mvp` (default): core
  CRM + website chat + advisory scoring/matching ON; public webhooks, real adapters,
  live sends, binary media OFF; background execution local-sync (non-production).
  Surfaced in the integration admin "Environment status" panel.
- **Authenticated receipt before parse.** `external_event_envelopes` (migration 0025)
  IS the metadata-only authenticated receipt persisted BEFORE the adapter parses
  (covers every required receipt field: tenant, connection, provider, received/auth
  timestamps, method, content-type/length, body hash, signature scheme/timestamp,
  correlation id, receipt idempotency key, adapter/mapping version, processing state,
  attempt count, failure category/summary, retention/completion). No separate
  `external_event_receipts` table was added to avoid duplication.
- **apps/web server tests (new).** `vitest.web.config.ts` runs server-service tests
  with a runtime no-external-IO trap (fetch/http/https/net/tls throw) — see
  `apps/web/test/*.web.test.ts`. Remaining server-test breadth (full ingestWebhook
  DB-backed flow, ambiguous-identity, dead-letter, post-normalization replay against a
  real DB) is tracked for the next increment; current evidence is the fake-DB service
  tests + the embedded-PG harness + build/typecheck.

## Phase 7A — server-integration verification pass (2026-06-20)

**Status correction.** Until the items below pass, Phase 7A uses the interim status
**"Server Integration Verification In Progress"** (supersedes the earlier "Locally
Complete and Simulated" wording). Core CRM remains deployable for the controlled MVP;
public provider webhooks stay disabled.

**Completed this pass:** service-level receipt-before-parse test (real `ingestWebhook`
against the in-memory fake — `apps/web/test/webhook-order.web.test.ts`: parse-time
envelope-exists, success, parse-failure→`resubmission_required`, duplicate receipt);
+4 harness envelope assertions (no raw/secret/auth column; adapter/mapping version
present; cross-tenant UPDATE+DELETE denied) → harness **338**; web tests **16**.

**Remaining locally-testable (next increment, not Phase 7B):**

- **Embedded-PostgreSQL DB-backed service scenario matrices.** Run `ingestConversationMessage`
  and `ingestLead` against the real embedded-PG harness (not the fake) for: new/duplicate/
  concurrent WhatsApp message, same external id in another tenant, email reply existing-vs-new
  conversation, unknown identity, ambiguous phone, unsupported content, failure-after-ingestion,
  retry; and lead phone/email normalization, dedupe, broker/direct overlap, first/last-touch
  attribution, assignment, unknown/ambiguous project mapping, concurrent duplicate, replay.
  Currently evidenced by the fake-DB service tests + the SQL harness + code enumeration.
- **Full 7-role runtime RLS matrix.** Client Admin / Sales Manager / Sales Agent / Marketing /
  Project-Maintenance / Viewer / Platform-Admin runtime assertions for connection mgmt,
  credential metadata, event + normalized-payload visibility, replay, mapping, health, human-send.
  3 roles are currently runtime-asserted; the rest are permission-seed-evidenced.
- **Per-event-type normalized-payload allow-list schemas** with size limits + retention +
  role-restricted read (replace storing broad `normalized_payload`).
- **Dead-letter / post-normalization replay** executed through the real service against embedded PG
  (decisions are domain-unit-tested via `decideReplay`; the worker-backed path is deferred with PGMQ).

## Phase 7A — final locally-testable pass (2026-06-20, part 2)

**Completed this pass (verified):**

- **Per-event normalized-payload minimization** — `packages/validation/src/normalized-payload.ts`
  defines allow-listed Zod schemas for all 14 event types (lead created/updated, inbound
  message, the five delivery callbacks, attachment, template, account-state, consent/opt-out,
  mailbox, unsupported). `minimizeNormalizedPayload()` drops unknown keys, truncates over-long
  fields, normalizes phone/email, **rejects secret-bearing payloads** (Bearer/authorization/
  cookie/sk-/EAA/ya29/AIza/GOCSPX/OAuth-refresh/Slack/private-key → review), and bounds
  serialized size (8 KB). Wired into `processEvent` so the stored `external_events.normalized_payload`
  is always the minimized subset — never the full provider payload. 6 unit tests (oversized,
  secret-bearing, over-broad, malformed-shape, callback allow-list, unsupported→empty).
- **Seven-role runtime authorization matrix (harness)** — runtime DB assertions over the live
  `role_permissions` graph for client_admin / sales_manager / sales_agent / marketing_manager /
  project_maintenance / viewer / platform_admin (manage/replay/credentials/mappings/events.read
  boundaries; platform_admin has no silent tenant integration grant).
- **Broadened cross-tenant INSERT matrix** — valid-fixture INSERT-denial now also on
  `external_event_attempts`, `external_identity_links`, `external_event_dead_letters` (plus the
  earlier connections / envelopes / webhook-endpoints / failures). Harness total **348**.

**Still remaining (the gating items — keep interim status):** the **embedded-PostgreSQL
real-service** scenario matrices for `ingestConversationMessage` and `ingestLead` (new/duplicate/
concurrent WhatsApp, cross-tenant external id, email new-vs-existing, unknown/ambiguous identity
review, dead-letter, post-normalization replay, delivery-callback) executed against the live
embedded PG **through the real TypeScript services**. Blocker: the embedded harness exposes raw
Postgres (`pg`) but the services talk to Supabase/PostgREST — a **pg-backed Supabase-client shim**
is the required next infrastructure piece. Until those land, the status stays **"Server Integration
Verification In Progress"**; current evidence for those services is the fake-DB server tests +
the SQL RLS harness + code enumeration.

## Phase 7A — embedded-PG infrastructure built; message-ingestion proven (2026-06-20, part 3)

**Blocker RESOLVED.** The "no PostgREST in the embedded harness" blocker is closed by a
pg-backed Supabase-client shim (`apps/web/test/pg-supabase.ts`), an embedded-PG boot helper
(`apps/web/test/pg-embedded.ts`, migrations 0001–0025 + seed), and a dedicated vitest project
(`vitest.pg.config.ts`, `pnpm test:pg`). New devDeps: `embedded-postgres`, `pg`, `@types/pg`
(lockfile updated; `pnpm install --frozen-lockfile` passes).

**Done:** `ingestConversationMessage` (+ `recomputeSlaAdmin`) now runs end-to-end against a
live embedded Postgres — `apps/web/test/pg-message-ingestion.pg.test.ts`, 5 scenarios: new
message (one ingestion event + message + trigger-seeded delivery event + `waiting_on='agent'`),
duplicate (no repeated downstream effect), same external id under a new idempotency key (unique
holds), same external id across two tenants (distinct), two distinct messages.

**Remaining embedded-PG matrices (now UNBLOCKED, incremental — still gate the promotion to
"Locally Complete and Simulated"):** lead ingestion via `ingestLead` (normalization, dedupe,
broker/direct overlap, first/last-touch attribution, assignment, unknown/ambiguous project
mapping, concurrent duplicate, replay); `simulateHumanSend` success + block paths against real
PG; delivery-callback routing transitions; dead-letter + post-normalization replay through the
real service. Each is now a straightforward test using the shim — no further infrastructure
needed. Status remains **"Server Integration Verification In Progress"** until they land.

## Phase 7A — lead-ingestion now embedded-PG verified (2026-06-20, part 4)

**Done:** the pg-backed shim now supports PostgREST embedded-relationship selects
(`table!inner(cols)` / `table(cols)` → SQL JOIN + `json_build_object`, `embed.col` filters,
`.is(col,null)`), so the **real `ingestLead`** runs end-to-end against embedded Postgres —
`apps/web/test/pg-lead-ingestion.pg.test.ts` (6 scenarios): new lead + completed event + source
event + first/last attribution + auto-assignment + `lead.create` audit; identical-payload
duplicate → idempotent completion; same key + different payload → **rejected** (conflict, no
silent overwrite); existing-phone collision → new lead + `lead_duplicates` review row (never
merged); broker/direct overlap flagged; replay after success → same lead, no new rows. Embedded-PG
total **11** (message 5 + lead 6).

**Remaining embedded-PG matrices (still incremental, still gate "Locally Complete and Simulated"):**
`simulateHumanSend` success + block paths against real PG; delivery-callback transitions
(accepted/sent/delivered/read/failed, duplicate/out-of-order/invalid-backward, unknown ref →
review, cross-tenant rejected); dead-letter + post-normalization replay through the real service.
All use the existing shim — no new infrastructure. Status remains **"Server Integration
Verification In Progress"** until they land.

## Phase 7A — ALL embedded-PG matrices complete → Locally Complete and Simulated (2026-06-20, part 5)

All five canonical server services now run end-to-end against a live embedded PostgreSQL
through the pg-backed Supabase shim (`pnpm test:pg`, **24** scenarios, 4 files):

- `ingestConversationMessage` (5) — new / duplicate / same-external-id / cross-tenant / two-distinct.
- `ingestLead` (6) — new lead +attribution +assignment +audit / identical-payload dup / same-key+different-payload→rejected / existing-phone→duplicate-review / broker-overlap / replay.
- `simulateHumanSend` (7) — success (one simulation, simulated=true, NO conversation message / delivery event / waiting-on change) + blocks (empty/closed/DNC/consent-revoked/channel-disabled/idempotent-replay).
- `requestReplay` + `deadLetterEvent` (4 within file) — dead-letter row; replay records intent only (no inline side effects); denied without permission/reason, for unknown, for already-succeeded, cross-tenant.
- delivery-callback routing (2) — recorded as a provider event only, never a customer message; duplicate receipt is an idempotent no-op.

The shim (`apps/web/test/pg-supabase.ts`) gained: PostgREST embedded-relationship joins
(`table!inner(cols)`, `embed.col` filters), `.is(col,null)`, and `.select(cols,{count,head})`.

**Status advanced to "Phase 7A — Locally Complete and Simulated".** All remaining work is
**Phase 7B external** (real provider IO, credentials, provider review, paid/compliance approval,
live Supabase, production PGMQ workers, Storage) — none of it locally testable. Safety switches
remain frozen; public webhooks stay disabled by default; automatic customer sending is impossible.

## Phase 7A — replay/callback/audit closeout (2026-06-20, part 6)

- **Local replay executor done** — `executeReplay` (`replay.ts`) + `reprocessExternalEvent`
  (`ingest.ts`) run synchronously through the job abstraction; production **PGMQ worker**
  execution remains the only deferred piece (shared 5B.0/6A/6B PGMQ item).
- **Delivery-callback lifecycle done** — callbacks advance `message_delivery_events`
  idempotently via `validateDeliveryTransition`; migration **0026** adds the callback
  idempotency anchor. Never creates a conversation/message; tenant-scoped; safe codes only.
- **Full RLS INSERT matrix** — cross-tenant INSERT denial now asserted across EVERY
  integration table (34) + the existing SELECT/UPDATE/DELETE loops. Harness **349**.
- **Remaining = Phase 7B external only**: real provider IO/credentials, provider review,
  paid/compliance approval, live Supabase, PGMQ workers, Storage, and a live end-to-end
  staging smoke. None locally testable. Safety switches frozen; public webhooks disabled by
  default; automatic customer sending impossible.
