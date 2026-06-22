# Shared Inbox

Inbox operations: assignment, transfer, status/priority, waiting-on, read state,
SLA, notes, tags, and canned replies. Authoritative code:
`apps/web/src/app/(app)/inbox/*`, migration `0012`.

## Visibility

`conversations.read.private` / `read.all` / `read.team` see all tenant
conversations; `read.metadata` sees conversation rows **without** message bodies
or internal notes; `read.assigned` (agents) sees only the agent's own
(assigned conversation or assigned lead). Saved views and search apply RLS-visible
ids **before** any filtering — they never broaden visibility.

## Assignment & transfer

`conversation_assignments` and `conversation_transfer_events` carry the full
history (previous/new owner + team, source, reason, initiator, ownership lock,
start/end, active). When a lead owner and a conversation owner differ, the inbox
**surfaces the mismatch and never silently synchronises** — an authorized manager
chooses which ownership changes, and the decision is recorded. _(History tables +
permissions exist; the assign/transfer history UI and owner-mismatch resolver are
tracked in `TECH_DEBT.md`.)_

## Status, priority, waiting-on

`conversation_status_history` and `conversation_priority_history` record every
transition (previous/new, actor, reason, timestamp, request/correlation id).
`changeStatusAction` and `changePriorityAction` write them and are permission-
gated (`conversations.close`/`reopen`, `conversations.priority.manage`).
Waiting-on (`agent` / `lead` / `system` / `none`) is computed deterministically by
`computeWaitingOn` from real message direction/status (internal notes never change
it; a failed outbound still owes a reply). Lifecycle adds `paused`, `resolved`,
`spam`, `archived` beyond the Phase-4 `open`/`closed`.

## Read state & SLA

`conversation_reads` is per-user: a user marks **only their own** row read (RLS
`profile_id = auth.uid()`), so reading never marks a conversation read for anyone
else. `computeSlaStatus` maps a due time to `on_track` / `due_soon` / `breached` /
`paused` (paused while waiting on the lead or in a non-active lifecycle).

## Notes, tags, canned replies

Internal notes (`conversation_notes`, visibility `assigned_agent`/`team`/
`manager_only`) are never sent to the customer, render distinctly, and don't
affect customer unread state. Canned replies resolve variables **server-side**
against an allow-list only (`resolveCannedReply`) — no HTML, no template
evaluation, unknown variables rejected. Tags are tenant-scoped.

_(Notes create + redaction + status/priority/mark-read are wired; the canned-reply
composer, tag filter, SLA display, history panels, unread badges, and mobile
sheets are tracked in `TECH_DEBT.md`.)_

## Phase 4.1 final wiring (2026-06-19)

- **Assignment**: interactive assign agent/team, unassign, lock/unlock ownership (`inbox/assign-control.tsx`). Eligibility (`evaluateEligibility`) gathers membership status, availability, absence window, team, project, language, workload and active-conversation count, surfacing exclusion reasons to managers; only eligible agents are offered. Owner mismatch shows both owners, requires a reason, never syncs silently, and preserves assignment/transfer history.
- **SLA chips** (On Track / Due Soon / Breached / Paused / Not Applicable) appear in the conversation list, detail panel, and mobile action sheet from the persisted `sla_status`.
- **Tags**: inbox tag filter (RLS-first), management page, authorized bulk tagging; disabled tags remain on history but are not newly assignable.
- **Saved views**: `saved_views` (entity=`conversations`) private/team/tenant; applying a shared view still runs under the viewer's RLS, so an assigned-only agent only ever sees their own conversations.
- **Mobile**: a sticky, safe-area-aware action sheet plus responsive list/thread/search/filter.
