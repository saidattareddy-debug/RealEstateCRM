# Phase 4.1 Audit — AI Safety & Inbox Completion

**Date:** 2026-06-19
**Scope:** Complete the message lifecycle, inbox operations, website-session
security and the AI-safety controls required **before** an automated responder
can be introduced (Phase 5).

**Constraints honoured:** No live Supabase. No Claude/OpenAI/Gemini, RAG, AI
answering, AI summaries, scoring, WhatsApp provider connectivity, or automated
follow-ups were implemented.

**Honest status:** This milestone is **partially complete**. The safety-critical
core and the entire data model are done and verified; a substantial fraction of
the inbox UI, transport, and website-session _wiring_ remains. Per the exit
criteria, the milestone is **not** marked complete, and the
"Phase 4 — Locally Complete and Verified" string is **not** set. This audit is
the honest map; the remediation column is the roadmap to completion.

---

## 1. Verification (gates that ran)

All on a sandbox-local copy (mount blocks `unlink`).

| Gate                                     | Result                          |
| ---------------------------------------- | ------------------------------- |
| `pnpm typecheck`                         | **PASS**                        |
| `pnpm test` (Vitest)                     | **PASS — 85 passed (10 files)** |
| `pnpm lint`                              | **PASS**                        |
| `pnpm format:check`                      | **PASS**                        |
| `pnpm build`                             | **PASS**                        |
| Secret scan (`service_role` in client)   | **PASS — admin.ts only**        |
| Migration apply `0001`–`0012` (clean DB) | **PASS**                        |
| RLS + idempotency harness                | **PASS — 166 passed, 0 failed** |

---

## 2. Hard AI execution boundary (§2) — **Complete**

`packages/domain/src/ai-guard.ts#canExecuteAutomatedReply` is the single guard.
`AI_RESPONDER_INSTALLED` is a compile-time `false`, so the function **always
denies** (`no_responder_installed`) regardless of any database flag. It returns a
fully-populated decision (tenant, conversation, operating mode, takeover, consent,
DNC, feature, knowledge, model statuses). `resumeTargetMode` can only return
`human` | `paused` — never `ai`. The live Resume control
(`ops-actions.ts#setOperatingModeAction` / `actions.ts#resumeAiAction`) sets
`operating_mode` to `paused` and keeps `ai_active=false`; takeover always sets
`human`. Tested in `ai-guard.test.ts` (responder-off, fully-enabled-still-denied,
non-open lifecycles denied, resume-never-ai). There are **no scattered AI checks**
elsewhere — there is no AI call site at all yet.

---

## 3. Requirement matrix

Classification is conservative: a table, flag, or planned interface is **not**
counted as a completed feature unless it is wired and used.

| #   | Item                       | Status                                                    | Where (files / tables)                                                                                                 | Permissions                         | Tests                                          | Remediation                                                                                      |
| --- | -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Channel accounts           | **Missing**                                               | website widget only (`website_chat_widgets`)                                                                           | `website_chat.manage`               | —                                              | Add `channel_accounts` for WhatsApp/email in the provider phases (5/7)                           |
| 2   | Conversation assignment    | **Partial**                                               | `conversation_assignments` (+RLS)                                                                                      | `conversations.assign`              | harness RLS                                    | Add assign/team/lock/unassign actions + UI; write assignment rows on assign                      |
| 3   | Transfer history           | **Partial**                                               | `conversation_transfer_events` (+RLS); transfer logs `conversation_events` today                                       | `conversations.transfer`            | harness RLS                                    | Write `conversation_transfer_events` on transfer; surface history panel; owner-mismatch resolver |
| 4   | Status history             | **Complete (data) / Partial (UI)**                        | `conversation_status_history`; `ops-actions.ts#changeStatusAction`                                                     | `conversations.close/reopen`        | harness RLS                                    | Add a history panel in the context column                                                        |
| 5   | Priority history           | **Complete (data) / Partial (UI)**                        | `conversation_priority_history`; `changePriorityAction`                                                                | `conversations.priority.manage`     | harness RLS                                    | History panel                                                                                    |
| 6   | Conversation tags          | **Partial**                                               | `conversation_tags` + `_assignments`; `toggleTagAction`                                                                | `conversations.tags.manage`         | harness RLS                                    | Tag management page + inbox tag filter                                                           |
| 7   | Message attachments        | **Partial (metadata only, by design)**                    | `message_attachments` (+RLS)                                                                                           | inherits conversation               | harness (RLS via parent)                       | Wire honest unavailable states; binary upload stays disabled until Storage                       |
| 8   | Message delivery events    | **Partial**                                               | `message_delivery_events` (+RLS); `validateDeliveryTransition` (domain, tested)                                        | inherits conversation               | `inbox.test.ts`                                | Emit delivery events on send/ack; render latest status                                           |
| 9   | Message read state         | **Partial**                                               | `conversation_reads` (+RLS isolation); `markReadAction`                                                                | `conversations.read.assigned`       | harness (own-row only; cannot mark for others) | Derive + render unread badges                                                                    |
| 10  | Unread counts              | **Partial**                                               | `conversation_reads.unread_count`                                                                                      | —                                   | —                                              | Safe derivation (exclude system/redacted/internal); inbox + nav badges                           |
| 11  | Message redaction          | **Complete**                                              | `message_redaction_events`; `redactMessageAction` (hash-only audit, body replaced)                                     | `messages.redact`                   | harness (perm gating)                          | Search exclusion lands with Search (#24)                                                         |
| 12  | Internal notes             | **Complete (core)**                                       | `conversation_notes` (+ visibility scopes, RLS); `NoteForm` + panel                                                    | `conversations.notes.create/manage` | harness RLS                                    | Edit→`conversation_note_versions`; tombstone UI                                                  |
| 13  | Canned replies             | **Partial**                                               | `canned_replies` + categories (+RLS); `resolveCannedReply` (safe substitution, tested)                                 | `canned_replies.manage`             | `inbox.test.ts`                                | Composer selector + settings management page                                                     |
| 14  | SLA tracking               | **Partial**                                               | `conversation_sla_policies` + `_events`; `computeSlaStatus` (tested)                                                   | `settings.org.manage`               | `inbox.test.ts`                                | Working-hours engine; emit SLA events; display chips                                             |
| 15  | Waiting-on state           | **Partial**                                               | `conversations.waiting_on`; `computeWaitingOn` (tested)                                                                | —                                   | `inbox.test.ts`                                | Write the column on message/event; show in list/detail                                           |
| 16  | Human-takeover history     | **Partial / safety Complete**                             | `conversation_events`; AI guard                                                                                        | `conversations.takeover/ai.resume`  | `ai-guard.test.ts`                             | Dedicated takeover-history view                                                                  |
| 17  | Consent history            | **Partial**                                               | `consent_events` (+RLS)                                                                                                | `consent.manage`                    | harness RLS                                    | Emit consent events from actions; lifecycle UI                                                   |
| 18  | Do-not-contact records     | **Complete (records+enforcement) / Partial (resolve UI)** | `do_not_contact_entries`; `addDncEntryAction`; reply path blocks via `isContactable`                                   | `dnc.manage`                        | harness; `conversation.test.ts`                | Resolve-with-reason UI; tenant policy for website transactional replies                          |
| 19  | Website sessions           | **Partial (schema only)**                                 | `website_chat_sessions` (+RLS, token_hash/version/expiry)                                                              | `website_chat.view_sessions`        | harness RLS                                    | Wire `/api/chat` to create/resolve sessions by signed token                                      |
| 20  | Returning visitor sessions | **Missing**                                               | —                                                                                                                      | —                                   | —                                              | Resume-by-token flow + anonymous visitor id                                                      |
| 21  | Widget token rotation      | **Missing**                                               | `token_version`/`rotated_at` columns exist                                                                             | `website_chat.manage`               | —                                              | Rotation action + install-page control                                                           |
| 22  | Polling transport          | **Missing**                                               | —                                                                                                                      | —                                   | —                                              | `ConversationTransport` (cursor, backoff, hidden-pause) + server repo                            |
| 23  | Widget install script      | **Missing**                                               | —                                                                                                                      | —                                   | —                                              | `/widget.js`, install page, `/chat/demo`                                                         |
| 24  | Inbox search               | **Missing**                                               | —                                                                                                                      | `conversations.read.*`              | —                                              | RLS-first id resolution → sanitized snippets; exclude redacted                                   |
| 25  | Saved inbox views          | **Missing**                                               | `saved_views` (leads) exists                                                                                           | `conversations.read.*`              | —                                              | Reuse saved-view arch for inbox; never widen visibility                                          |
| 26  | Message retries            | **Partial**                                               | `message_ingestion_events` (unique `(tenant,key)` + partial `(tenant,widget,external)`), `_attempts`, idempotency keys | `settings.audit.read`               | harness (idempotency + visibility)             | Wire `/api/chat` inbound through the ingestion pipeline + job driver                             |
| 27  | Message dead letters       | **Partial**                                               | `message_dead_letter_events` (+RLS)                                                                                    | `settings.audit.read`               | harness RLS                                    | Producer + replay                                                                                |
| 28  | Summary versioning         | **Partial**                                               | `conversation_summary_versions` (CHECK: no `ai_generated`, no model/prompt)                                            | `conversations.reply`               | harness (CHECK rejects ai/model)               | Switch `generateSummary` to write versions                                                       |

**Read scopes added:** `read.all`, `read.team`, `read.metadata`. Metadata-only
(marketing) sees conversation rows but **not** message bodies or internal notes
(content `SELECT` policies require a content read scope). Verified by policy +
role-bundle invariant (marketing has no content scope). Runtime test for a
metadata-only _user_ is deferred (no marketing user in the seed) — tech-debt.

---

## 4. Permissions & RLS

22 conversation/message/consent permissions exist (5 from Phase 4 + 18 new). The
role-seed path was made **new-tenant-safe**: `grant_phase41_conversation_perms`
is called from `on_tenant_created` and backfills existing tenants. Every new
table has direct RLS assertions in the harness (assignment, transfer, status/
priority history, reads, SLA, delivery, ingestion/attempts/DLQ, notes, canned,
tags, consent, DNC, redaction, attachments, sessions, summary versions). Agents
remain assigned-only (they do **not** receive `read.metadata`).

---

## 5. Exit-criteria status

Met: AI execution impossible before Phase 5 ✔; status/priority history (data) ✔;
per-user read-state isolation ✔; redaction ✔; internal notes ✔; consent/DNC
records + enforcement ✔; message idempotency (DB) ✔; summary-version constraints
✔; every new table has RLS tests ✔; format/lint/typecheck/unit/harness/migration-
order/secret-scan/build ✔.

**Not yet met** (blocking completion): waiting-on wiring; full SLA engine +
display; delivery-event production; message-ingestion producer wiring; canned-
reply composer + management UI; tag/assignment/transfer/status/priority history
UI; returning sessions + token rotation + session wiring; widget install script +
demo; polling transport; inbox search; saved inbox views; mobile inbox sheets;
unread badges. See the matrix remediation column and `TECH_DEBT.md`.

**Conclusion:** Foundation (safety + schema + RLS + domain) is complete and
verified; feature wiring is in progress. Phase 4.1 remains **open**.
