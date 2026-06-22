# Phase 4.1 — Completion Audit

**Date:** 2026-06-19
**Scope:** Final wiring and closeout of the Phase 4.1 Technical-Debt Register
(AI Safety & Inbox Completion). No live Supabase; no AI answering, RAG, AI
summaries, scoring, WhatsApp provider, or automated follow-ups. The hard AI
execution boundary remains disabled (`AI_RESPONDER_INSTALLED = false`;
`canExecuteAutomatedReply` always denies).

**Headline:** Every required local workflow is implemented, wired into the
application, and verified. All nine gates pass. The remaining deferrals are the
sanctioned external ones (live Supabase, PGMQ execution, Realtime, Storage,
production provider connectivity).

---

## 1. Gates (this pass)

| Gate                                        | Result                                   |
| ------------------------------------------- | ---------------------------------------- |
| `pnpm format:check`                         | **PASS**                                 |
| `pnpm lint`                                 | **PASS — 0 errors**                      |
| `pnpm typecheck`                            | **PASS**                                 |
| `pnpm test` (Vitest)                        | **PASS — 146 (16 files)**                |
| Embedded-Postgres RLS + idempotency harness | **PASS — 197 passed, 0 failed**          |
| Migration apply `0001`–`0016` (clean DB)    | **PASS**                                 |
| Migration-order validation                  | **PASS**                                 |
| Secret scan                                 | **PASS — no service-role/`oc_` leakage** |
| `pnpm build` (production)                   | **PASS**                                 |

> `pnpm install --frozen-lockfile` is the CI gate on a normal machine. In the
> agent sandbox the connected-folder mount blocks `unlink`, so dependencies are
> installed and all gates are run on a sandbox-local copy of the repo.

## 2. Exact migrations added

- **`0016_inbox_final_wiring.sql`** — extends `conversation_sla_events` with the
  full lifecycle kinds (`started`, `due_recalculated`, `due_soon`, `closed`,
  `reopened` added to the existing set) plus `previous_due_at`, `reason`,
  `correlation_id`; adds `conversations.sla_status`; adds membership eligibility
  signals (`availability`, `absent_from`, `absent_until`,
  `max_active_conversations`, `languages`); adds minimal `teams` + `team_members`
  and `conversations.assigned_team_id`; adds `canned_reply_usage_events` (records
  which reply was used, never the resolved body); adds saved-view inbox fields
  (`section`, `density`, `panels`). Per-command RLS for every new table.

(Phase 4.1 migrations `0012`–`0015` were added in earlier passes.)

## 3. Exact files changed (this pass)

**Domain (`packages/domain/src`)**: `polling.ts` (+`__tests__/polling.test.ts`),
`sla-events.ts` (+`__tests__/sla-events.test.ts`), `eligibility.ts`
(+`__tests__/eligibility.test.ts`), `index.ts` (exports).

**Transport**: `apps/web/src/lib/transport/{types.ts,polling.ts}` (DI + initial
cursor + stop-on-close).

**Inbox**: `inbox/[id]/message-thread.tsx` (new, live thread),
`inbox/[id]/mobile-sheet.tsx` (new), `inbox/[id]/page.tsx` (wire thread, assign,
mobile sheet), `inbox/sla.ts` (new, `recomputeSla`/`recomputeSlaAdmin`),
`inbox/assign-actions.ts` (team assign + eligibility), `inbox/assign-control.tsx`
(new), `inbox/canned-actions.ts` (new), `inbox/tag-actions.ts` (new),
`inbox/saved-view-actions.ts` (new), `inbox/inbox-views.tsx` (new),
`inbox/inbox-forms.tsx` (canned picker), `inbox/page.tsx` (SLA chip, tag filter,
views bar, management links), `inbox/actions.ts` + `inbox/ops-actions.ts` (SLA
recompute on reply/status/priority/transfer/close/reopen).

**Settings**: `settings/canned-replies/{page.tsx,canned-manage.tsx}`,
`settings/tags/{page.tsx,tag-manage.tsx}`.

**Website chat**: `api/chat/[widgetId]/message/route.ts` (inbound SLA recompute),
`chat/widget/[widgetId]/widget-client.tsx` (presented-state ack + unread post),
`widget.js/route.ts` (launcher unread badge + visibility signalling).

**Shell**: `(app)/layout.tsx` + `components/app-shell/mobile-nav.tsx` (inbox
unread badge).

**Tests/harness**: `supabase/tests/local-harness/run.mjs` (migration 0016 +
SLA-kind/teams/canned-usage assertions).

## 4. Unit-test totals

**146** Vitest assertions across 16 files (was 114). New this pass: polling **13**
(hydration, incremental, equal-timestamp ordering, duplicate, cursor replay,
network failure, reconnect/back-off, hidden-tab cadence, closed-conversation
stop), SLA events **9** (started/due/recalculated/due-soon/breach/breach-resolved/
first-response-met/paused/resumed/closed/reopened), eligibility **10**
(membership/availability/absence/team/project/language/workload/lock + multi-reason).

## 5. Database-harness assertion totals

**197** assertions, 0 failures, migrations `0001`–`0016` from a clean DB + seed.
New this pass: SLA-event lifecycle kinds + provenance accepted and bad kind
rejected; membership eligibility defaults; teams readable by members but
writable only with `assignment.configure`; canned-reply-usage tenant isolation.

## 6. Result by required (non-deferrable) workflow

| Workflow               | Result    | Evidence                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polling → inbox wiring | Completed | `message-thread.tsx` mounts `PollingTransport` (initial SSR page + cursor resume, dedup, scroll-preserve, near-bottom auto-scroll, "new messages" control, hidden-tab slowdown, back-off, closed-stop, honest connected/reconnecting/offline/expired states, never "realtime", no fake typing). Reconcile/back-off proven by 13 unit tests. |
| Visitor read semantics | Completed | Ack only on explicit `ackMessageId` while the panel is presented; collapsed widget keeps polling (delivery) without acking; cross/expired/rotated tokens cannot ack; internal/redacted excluded from unread.                                                                                                                                |
| Unread badges          | Completed | Widget launcher badge (postMessage, same-origin), mobile-nav Inbox badge, inbox section total, conversation-row dots.                                                                                                                                                                                                                       |
| SLA-event emission     | Completed | `recomputeSla` emits `conversation_sla_events` with policy id, due, previous due, reason, correlation id on all listed triggers; chips in list/detail/mobile; real timestamps only.                                                                                                                                                         |
| Assignment UI          | Completed | Interactive assign agent/team, unassign, lock/unlock; eligibility with exclusion reasons for managers; owner-mismatch resolver (both owners, reason-required, no silent sync, history preserved).                                                                                                                                           |
| Mobile inbox           | Completed | Purpose-built sticky safe-area action sheet + responsive list/thread/search/filter; unread/SLA/owner/mismatch/DNC/takeover/connection indicators reachable; large touch targets; no hover-only.                                                                                                                                             |
| Canned replies         | Completed | Management page (create/edit/disable/categories/search/language-project-channel filters/usage) + composer picker; server-side variable resolution against the allow-list; reply/status/consent/DNC/takeover/mode enforced via the shared reply path; only the reply id is logged.                                                           |
| Tags                   | Completed | Management page (create/rename/disable/colour) + inbox tag filter (RLS-first) + authorized bulk tagging + audit; disabled tags stay on history but are not newly assignable.                                                                                                                                                                |
| Saved inbox views      | Completed | `saved_views` (entity='conversations') private/team/tenant; RLS-first apply means a shared manager view opened by an assigned-only agent returns only that agent's conversations.                                                                                                                                                           |

## 7. Remaining approved deferrals

- Official Supabase verification (`supabase db reset` + `supabase test db` pgTAP
  on a live/Docker project) — no live project.
- Production PGMQ execution, Supabase Realtime, Supabase Storage, production
  provider connectivity — interfaces exist; deferred to their phases.
- Sub-feature nuances documented in `TECH_DEBT.md` (mobile uses responsive
  routes not mobile-only routes; project-authorization eligibility treated as
  all-projects pending schema; SLA per-conversation override not modelled;
  widget "last configuration-update" timestamp not separately surfaced).

## 8. Phase 5 readiness decision

**Ready for review.** All required Phase 4.1 workflows are implemented, wired,
and verified, and all nine local gates pass. Phase 5 (Knowledge & AI) remains
unstarted and still requires external AI-provider credentials + paid-service
approval. The AI execution boundary stays hard-disabled until a Phase-5 responder
explicitly flips `AI_RESPONDER_INSTALLED` and routes through
`canExecuteAutomatedReply`.

---

```text
Phase 4.1 — Locally Complete and Verified
Live Supabase — Deferred
Production Verification — Pending
Phase 5 — Ready for Review
```
