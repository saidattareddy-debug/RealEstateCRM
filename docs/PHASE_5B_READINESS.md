# Phase 5B.0 — Live-Send Readiness

**Status:** Record-only. Automatic customer sending is currently **impossible** by construction. This document is the central readiness reference for Phase 5B.0 — it states honestly what is locally implemented, what is only simulated, and what each remaining step (external credentials, a live Supabase project, legal approval, product approval) requires before any customer message could ever be sent. Nothing in 5B.0 sends, or can be made to send, a message to a real customer.

**Date:** 2026-06-20

This doc complements [`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md) (the operator checklist), [`AI_SECURITY.md`](./AI_SECURITY.md) (the AI safety model), and the new policy set: [`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md), [`AI_ROLLOUT_PLAN.md`](./AI_ROLLOUT_PLAN.md), [`AI_DELIVERY_LIFECYCLE.md`](./AI_DELIVERY_LIFECYCLE.md), [`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md), [`AI_PROVIDER_PRIVACY.md`](./AI_PROVIDER_PRIVACY.md), and [`AI_OBSERVABILITY.md`](./AI_OBSERVABILITY.md).

---

## 1. The one thing to understand first

A customer-visible automatic send is not "disabled by a setting you could toggle." It is prevented by several independent layers, each of which must be changed by a reviewed PR before a send is even representable:

- **Compile-time master switch.** `LIVE_SEND_MASTER_SWITCH = false` in [`packages/domain/src/ai-live-send.ts`](../packages/domain/src/ai-live-send.ts). The global send-gate result is ANDed with this constant, so even a DB configuration with every flag on can never produce `allowed = true`.
- **Compile-time responder constant.** `RESPONDER_LIVE_SENDING = false` in [`packages/domain/src/ai-responder.ts`](../packages/domain/src/ai-responder.ts). `decideResponderOutcome` can only return `blocked | escalate | suppressed`; `delivered` is the literal `false`.
- **Decision CHECK forbids delivery.** `ai_responder_decisions` has `CHECK (outcome in ('escalate','suppressed','blocked'))` ([`0019_ai_responder.sql`](../supabase/migrations/0019_ai_responder.sql)); `deliver` is not storable.
- **Outbox enums forbid a sent state.** Migration 0020 defines `send_candidate_status` with **no** `delivered`/`sent` value and `responder_runtime_mode` with **no** active `live` value. A customer send is therefore not even recordable in the schema.

Because these are layered and independent, flipping any one alone is a no-op. They are designed to fail safe.

---

## 2. What is implemented locally (real code, runs today)

These exist, compile, and are exercised by the unit suite and the embedded-Postgres harness. None of them send anything.

- **Responder decision core** — [`packages/domain/src/ai-responder.ts`](../packages/domain/src/ai-responder.ts): `decideResponderOutcome` returns `blocked | escalate | suppressed` while the responder constant is false.
- **Live-send gate engine** — [`packages/domain/src/ai-live-send.ts`](../packages/domain/src/ai-live-send.ts): `evaluateLiveSendGates` (15 layered gates), `buildAutomaticSendIdempotencyKey`, `shouldCancelStaleCandidate`, `revalidateAutomaticSend`, the `OutboundDeliveryTransport` contract, and `summarizeLiveSendEvaluations` (headline `delivered` count must be 0 to be `safe`).
- **Server responder service (record-only)** — [`apps/web/src/lib/ai/responder.ts`](../apps/web/src/lib/ai/responder.ts): `runResponder` runs the orchestrator in shadow/mock and records a non-sent `ai_responder_decisions` row plus an escalation row. It never inserts a `conversation_messages` row, a delivery row, a status change, or a waiting-on change.
- **Auto-trigger (record-only)** — `apps/web/src/app/api/chat/[widgetId]/message/route.ts`: fires `runResponder` only when `operating_mode = 'ai'`, wrapped so a failure cannot break the inbound acknowledgement.
- **Review UI** — `/ai/responder` (permission `ai.runs.read`; outcome filter chips + counts) and the per-conversation inbox panel `apps/web/src/app/(app)/inbox/[id]/responder-panel.tsx` with a permission-gated (`ai.shadow.manage`) "Run responder (no send)" button.
- **Runtime/outbox schema (forward-only)** — [`supabase/migrations/0020_responder_runtime_outbox.sql`](../supabase/migrations/0020_responder_runtime_outbox.sql): the enums, the five new RLS-enabled tenant-scoped tables (`responder_channel_settings`, `responder_activation_requests`, `responder_activation_approvals`, `ai_send_candidates`, `ai_send_attempts`), the two-person activation guard (`responder_approval_requester_guard`), the new permissions, and the audit actions.

The five new tables let the platform _model_ a runtime-enabled, two-person-approved, rate-limited, rolled-out responder with a transactional outbox — but the `send_candidate_status` enum has no delivered/sent value, so the outbox can hold a candidate and never a sent message.

## 3. What is only simulated (runs, but performs no external IO)

- **Delivery transports** — four `OutboundDeliveryTransport` simulations in [`ai-live-send.ts`](../packages/domain/src/ai-live-send.ts): dry-run, failure (retryable), timeout (uncertain), and success-simulation. The success simulation sets a `sim-<key>` provider reference and marks `simulated: true`; it does **not** perform a network call or create a `conversation_messages` row.
- **Outbox candidates** — `ai_send_candidates` rows can be created and revalidated, but only ever reach `pending | revalidating | suppressed | simulated | cancelled | dead_letter`. There is no `delivered`/`sent`.
- **Worker revalidation** — `revalidateAutomaticSend` re-checks every gate at "worker time," but never proceeds while the master switch is false.
- **Reconciliation** — `reconcileUncertainAttempt` routes an uncertain/timeout attempt to `manual_review` and never resends; a known provider reference is treated as confirmed (no resend). This is the contract a real worker would follow, exercised today against simulated results only.

## 4. What requires external credentials

- A real, server-only AI chat + embedding provider credential referenced by `ai_provider_configs.secret_ref` (never in the browser, repo, logs, audit, prompts, or plaintext DB).
- A real delivery channel credential (e.g. WhatsApp Business / email transport secrets).
- Webhook/delivery callback signing secrets for the chosen channel.

None of these exist in the repo today; the secret*ref model stores only the env-var \_name*.

## 5. What requires a live Supabase project

- A real project (not the embedded-Postgres harness) with `pgvector` installed, all migrations `0001–0020` applied, and the official `supabase db reset` + `supabase test db` (pgTAP) passing.
- The pgvector ANN retrieval path for a fixed embedding model/dimension. The embedded harness has no pgvector and uses a portable in-SQL cosine; ANN is deferred (see [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) and [`TECH_DEBT.md`](./TECH_DEBT.md)). ANN is a _performance_ gate, not a correctness gate — see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## 6. What requires legal / compliance approval

- Written sign-off to send automated messages on each channel: consent basis, WhatsApp template/session rules, do-not-contact and opt-out handling, and regional/data-residency requirements.
- A provider Data Processing Agreement and a documented retention / training-use position before any customer text leaves the platform (see [`AI_PROVIDER_PRIVACY.md`](./AI_PROVIDER_PRIVACY.md)).

## 7. What requires product approval

- Paid-service sign-off to incur provider usage cost at production volume, with the per-tenant `ai_usage_limits` reviewed and set.
- Approval of the canary category allow-list and the shadow-soak acceptance thresholds (see [`AI_ROLLOUT_PLAN.md`](./AI_ROLLOUT_PLAN.md)). The thresholds are deliberately left as configurable placeholders in this doc set; production numbers are not invented here.
- Approval of which single tenant/channel is enabled first.

## 8. What remains deliberately impossible in 5B.0

By design, and not changeable by configuration alone:

- Any customer-visible automatic send. The master switch is false, the outbox enum has no delivered/sent state, and the decision CHECK forbids `deliver`.
- Recording a delivered candidate or an automatic run. `ai_runs` keeps `CHECK (mode <> 'automatic')`; `send_candidate_status` has no sent value.
- Enabling sending through the database alone. Every DB flag (channel mode, rollout percentage, activation approvals) is ANDed with the compile-time master switch.

## 9. The 5B.0 vs 5B.1 split

**5B.0 (this phase, done in-repo):** the record-only responder hardening — the live-send domain core, the runtime/outbox schema, two-person activation, the kill-switch model, and this documentation set. Everything is simulated or impossible; nothing sends.

**5B.1 (a separate, reviewed, credentialed PR — not autonomous):** flipping `LIVE_SEND_MASTER_SWITCH`; configuring real server-only provider credentials; paid-service approval; a live Supabase project + pgvector ANN; legal/compliance sign-off; a real delivery channel; widening the `ai_runs` / `ai_responder_decisions` / `send_candidate_status` CHECKs via new forward-only migrations; replacing the compile-time master switch with runtime per-tenant/channel enablement enforcement; and wiring real PGMQ worker execution. The durable-job abstraction lives in [`apps/web/src/lib/jobs/`](../apps/web/src/lib/jobs/) with SyncLocal/Outbox drivers today; PGMQ is deferred.

Each 5B.1 change is individually fail-safe: doing one without the others stays a no-op. Live sending is permitted only after the full sign-off in [`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md).

---

## 10. Verification state

- Migrations `0001–0020`.
- Embedded-Postgres RLS + similarity harness: **275 passed / 0 failed**, including the 8 Phase-5B.0 assertions (no `live` enum value, no `delivered`/`sent` status, the five new tables under RLS, a candidate cannot be marked delivered, idempotency uniqueness, a simulated candidate creates no customer message, a requester cannot self-approve, tenant-B isolation).
- Domain unit tests: **233**.
- The harness has no pgvector (portable in-SQL cosine); pgvector ANN is deferred to a live project.

See [`TEST_PLAN.md`](./TEST_PLAN.md) for the test enumeration and [`SECURITY.md`](./SECURITY.md) for the fail-safe security scenarios.
