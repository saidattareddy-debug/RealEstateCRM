# Lead CRM

How leads are represented, qualified, assigned, progressed, contacted, exported,
and viewed. Complements [`LEAD_INGESTION.md`](./LEAD_INGESTION.md) (how leads
enter the system) and [`DATABASE.md`](./DATABASE.md) (schema). Authoritative
behaviour is the code under `apps/web/src/app/(app)/leads/*`,
`packages/domain/*`, and migrations `0008`–`0010`.

## Lead lifecycle

A lead has an `operational_status`, a `stage_id` (pipeline position), an optional
active assignment, contacts, preferences, source events, attribution touchpoints,
notes, tasks, calls, duplicate candidates, and audit history. Children inherit the
lead's RLS visibility (a row is visible iff its lead is visible).

## Qualification completeness

`packages/domain/src/qualification.ts#computeCompleteness` scores how much
information has been gathered against the tenant's configurable
`qualification_fields` (importance: `required` / `important` / `optional` /
`disabled`). It returns overall / required / important percentages plus the lists
of missing required and important fields, and is shown on the lead detail page.

**It is explicitly not a quality signal** — there is no Hot/Warm/Cold scoring here
(scoring is Phase 6). A lead can be 100% complete and still be a poor fit.

## Pipeline rules

Stage moves run through `moveStageAction` server-side:

- Moving into a terminal stage (`pipeline_stages.is_lost = true`, i.e. **Lost** or
  **Disqualified**) **requires a reason**; the request is rejected without one.
- The move records a `lead_stage_history` row and an audit entry, and sets
  `operational_status` appropriately.
- Authorization is by permission (`pipeline.move`) and tenant, never role name.

The pipeline funnel shows only real stage counts — no projected or fabricated
numbers.

## Assignment

Deterministic, load-aware assignment lives in `packages/domain/src/assignment.ts`
(Phase 3). Manual assignment/reassignment is permission-gated
(`leads.assign` / `leads.reassign`). Broker/direct overlap is detected at
ingestion and resolved in the duplicate-review UI (migration `0009`).

## Calls (no telephony)

`calls` (migration `0010`) is a manual call log: direction, status (DB enum
`call_status`: connected / no_answer / busy / wrong_number / switched_off /
callback_requested / cancelled), duration, outcome, notes, and an optional
callback that creates a task. Logging requires `calls.manage`. **A call is visible
only if its lead is visible** — enforced by a lead-scoped `SELECT` policy with
per-command write policies (see [`SECURITY.md`](./SECURITY.md)).

## Saved views

`saved_views` (migration `0010`) persist filters/sort/columns/page-size per user
with a scope of `private` / `team` / `tenant`. **A saved view never widens the
caller's RLS visibility** — it only stores presentation state; the underlying lead
RLS still applies. Sharing beyond `private` requires `leads.read.team`; only the
owner can edit their view.

## Secure export

`/leads/export` streams the caller's **RLS-visible** leads only, gated by
`leads.export`, capped at 5000 rows, and audited (`EXPORT_REQUEST`). CSV values
that begin with `=`, `+`, `-`, `@`, tab, or CR are prefixed with an apostrophe to
neutralise spreadsheet formula injection. Raw provider payloads, secrets, and
internal RLS values are never exported. (XLSX export, column selection, and
large-file background export are deferred — see `PHASE_3_1_AUDIT.md` §4.)

## Lead detail surfaces

`/leads/[id]` shows status & pipeline, assignment, qualification completeness,
calls, notes, tasks, and stage history, with permission-gated editing. On mobile
a sticky action bar offers Call (`tel:`), WhatsApp (**external `wa.me` link
only**), Note, Task, and Stage.
