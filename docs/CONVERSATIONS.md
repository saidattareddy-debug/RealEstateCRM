# Conversations

The message/conversation model, shared + agent inbox, website chat widget,
human takeover, conversation summaries, and the consent / do-not-contact (DNC)
model (Phase 4). Authoritative behaviour is the code under
`apps/web/src/app/(app)/inbox/*`, `apps/web/src/app/api/chat/*`,
`packages/domain/src/conversation.ts`, and migration `0011`.

## Scope and deferrals

Phase 4 delivers the **conversation infrastructure**. Two pieces are deferred by
interface, consistent with prior phases:

- **AI answering** is Phase 5. Conversations carry an `ai_active` flag that the
  future responder must respect; human takeover sets it `false`. No AI is called
  here. Conversation summaries are produced **deterministically** now
  (`source = 'deterministic'`); the AI source (`'ai'`) is reserved for Phase 5.
- **Supabase Realtime** (live inbox push) needs a live project and is deferred.
  The inbox is server-rendered and refreshes on navigation/action; the model and
  APIs are complete.

## Model (migration 0011)

`conversations` (channel, status, `ai_active`, `human_takeover_by/at`,
`assigned_agent_id`, `last_message_at`, `last_inbound_at`, `needs_response`,
`external_thread_id`, `widget_id`) → has many `conversation_messages`
(direction, sender, body, `external_message_id` for idempotent inbound, media,
metadata), `conversation_participants`, `conversation_summaries`, and
`conversation_events` (takeover / resume / transfer / close / reopen / assign).
`website_chat_widgets` holds per-tenant embed config; `contact_consents` holds
the consent/DNC records.

## Human takeover

Taking over (`conversations.takeover`) sets `ai_active = false`, records
`human_takeover_by/at`, assigns the conversation to the agent, and logs a
`takeover` event. Resuming clears the takeover and sets `ai_active = true`. The
future AI responder must not answer while `ai_active` is false.

## Conversation summary (deterministic)

`buildDeterministicSummary` (pure, unit-tested) rolls up the message log: message
counts, the last inbound message, an **unanswered inbound question** (only if no
outbound message followed it), and a recommended next action. It never invents
content and never answers on the lead's behalf.

## Inbox

`/inbox` lists conversations with filters: All, My inbox, Unassigned, AI-active,
Human takeover, Needs response, Closed. Each row shows the channel, an AI/Human
badge, and a needs-response/overdue badge computed by `needsResponse` (open +
last activity inbound; overdue past the SLA window). `/inbox/[id]` shows the
message thread, a reply box, the lead-context panel, the latest summary, the
event log, and the takeover / resume / transfer / close / generate-summary
controls — each gated by the matching permission.

## Consent / Do-Not-Contact

`contact_consents` records `granted` / `revoked` / `do_not_contact` per channel
(`whatsapp` / `email` / `sms` / `call` / `any`), per lead or per raw contact
value. `isContactable` (pure) blocks an outbound message when a `revoked` or
`do_not_contact` record applies to the channel (or to `any`). **Every outbound
reply checks DNC before sending.** Consent updates require `leads.update` and are
audited (`consent.update`, security-flagged).

## Website chat widget

Public, hardened endpoints (no session; service-role server-side only):

- `POST /api/chat/[widgetId]/start` — `widgetId` is the widget's **public key**.
  Validates origin allow-list, size cap, rate limit, timestamp window, honeypot,
  and consent; creates/resolves the lead via the idempotent ingest pipeline,
  opens a `website_chat` conversation keyed by an opaque session id, and stores
  the first inbound message. Returns **only** that opaque session id.
- `POST /api/chat/[widgetId]/message` — appends an inbound message to the session
  (idempotent on `external_message_id`).

Both return **non-disclosing** responses: they never reveal whether a contact
already exists, and never expose tenant, lead, or conversation identifiers or
database errors. The embed contract for the browser is a small script that POSTs
JSON to these two endpoints with the public key and (optionally) a per-message
`clientMessageId`; no secret is ever shipped to the browser.

## RLS

`conversations.read.private` sees all tenant conversations; `read.assigned` sees
only the agent's own (assigned conversation or assigned lead). The Project Data &
Maintenance role has neither and is denied (also enforced as a role-bundle
invariant). Child tables (messages, participants, summaries, events) inherit
conversation visibility via an RLS-filtered subquery, and writes are split
per-command so a `FOR ALL` policy can never widen `SELECT`. Widget config is
`settings.org.manage`; consent is `leads.read.assigned` (read) / `leads.update`
(write). See [`SECURITY.md`](./SECURITY.md).

## Phase 4.1 (in progress)

Phase 4.1 extends conversations with the AI execution boundary, the full message
lifecycle, and inbox operations. The detailed model and security live in
[`HUMAN_TAKEOVER.md`](./HUMAN_TAKEOVER.md), [`SHARED_INBOX.md`](./SHARED_INBOX.md),
[`WEBSITE_CHAT.md`](./WEBSITE_CHAT.md), and
[`MESSAGE_LIFECYCLE.md`](./MESSAGE_LIFECYCLE.md). Current completeness and the
remediation roadmap are in [`PHASE_4_1_AUDIT.md`](./PHASE_4_1_AUDIT.md) and
[`TECH_DEBT.md`](./TECH_DEBT.md). Notably, `operating_mode` (human/paused/ai)
replaces `ai_active` as the AI-gating state, and no automated reply can run until
Phase 5 (`canExecuteAutomatedReply` always denies).

## Phase 4.1 final wiring (2026-06-19)

The conversation detail now renders a **live thread** (`inbox/[id]/message-thread.tsx`) backed by the polling transport: initial server-rendered page, cursor-resumed incremental polling, stable `(created_at,id)` merge + dedup, scroll preservation with a near-bottom auto-scroll and a "new messages" control, hidden-tab slowdown, exponential back-off, and honest connection states (connected-through-polling / reconnecting / offline / session-expired). Closed conversations reconcile once and stop. Polling is never presented as realtime; there are no fabricated typing/presence indicators.
