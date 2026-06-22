# Automations & Visits (Phase 8)

The Phase 8 surface adds workflow **automations**, score-aware **follow-up
sequences**, the **site-visit** lifecycle with **double-booking prevention**, a
**simulation-only calendar**, and **notifications**. It is the explicitly-approved
automation phase: automations may perform real _internal_ mutations
(stage/assignment/task/tag/note/notification), but **no customer message is ever
sent** — that remains gated by the compile-time `LIVE_SEND_MASTER_SWITCH`
(Phase 5B.1) and a live channel (Phase 7B).

Schema: migration `0029_automations_visits.sql` (16 tenant-scoped, RLS-protected
tables). Domain: `packages/domain/src/{automation,followup,visits,notifications}.ts`
(pure, no IO). Server: `apps/web/src/lib/{automations,followups,visits,notifications}/`.

---

## 1. Safety model (the headline)

Two record-types could in principle represent a customer send — automation
customer-send actions and follow-up step sends. Both are made impossible at three
layers:

1. **Domain** — `evaluateAutomation` and `decideFollowUpStep` AND their send paths
   against `LIVE_SEND_MASTER_SWITCH` (compile-time `false`), so every send result
   carries `willSend: false` + `suppressedReason: 'live_send_master_switch_off'`.
   Proven by `automation.test.ts` / `followup.test.ts`.
2. **Database** — `automation_run_actions.will_send` and
   `followup_step_events.will_send` are `boolean not null default false
check (will_send = false)`. A delivered automatic message cannot even be stored.
   Proven by `pg-phase8.pg.test.ts`.
3. **Server** — the services record customer-send actions with
   `status='suppressed'`, `will_send=false`; internal actions execute for real.

Calendar is **simulation-only**: `calendar_connections.status` is constrained to
`disconnected | simulated` (never `connected`); no network IO occurs. External
notification deliveries are recorded `simulated=true` (DB CHECK: a non-`in_app`
channel must be simulated).

---

## 2. Automations

`automations` (trigger + condition group + ordered `automation_actions`) →
`runAutomationForEvent(supabase, {tenantId, trigger, facts, changedFields, leadId})`
loads enabled automations for the trigger, calls `evaluateAutomation`, and records
an `automation_runs` row + one `automation_run_actions` row per resolved action.

- **Triggers**: lead_created, lead_stage_changed, lead_score_changed,
  conversation_inbound, conversation_idle, visit_scheduled, visit_completed,
  visit_no_show, task_overdue, time_schedule.
- **Conditions**: AND/OR groups over 12 operators (eq/neq/gt/gte/lt/lte/in/not_in/
  contains/exists/not_exists/changed). Empty group = always matches.
- **Actions**: internal (create_task, change_stage, assign_lead, add_tag, add_note,
  notify_user, enroll_sequence, unenroll_sequence) executed for real;
  customer_send (send_whatsapp_template, send_email) recorded **suppressed**.
- **Anti-loop**: `max_runs_per_lead`.

UI: `/automations` (list + enable toggle + create), `/automations/[id]` (trigger /
conditions / actions editor + runs log clearly marking customer-send actions as
"suppressed (not sent)"). Permission: `automations.read` / `automations.manage`.

---

## 3. Follow-up sequences

`followup_sequences` + ordered `followup_steps` (delay, channel, template,
`only_score_categories`). A lead is enrolled (`followup_enrollments`, at most one
active per sequence/lead). `tickEnrollment` loads live context (DNC, consent,
human-takeover, converted/lost, customer-replied, current score category) and calls
`decideFollowUpStep`, writing a `followup_step_events` row.

- **Stop conditions** (priority order): sequence_disabled, dnc_active,
  consent_revoked, human_takeover, lead_converted, lead_lost, opted_out,
  customer_replied, max_steps_reached.
- **Quiet hours**: tenant-local 20:00–09:00 (configurable) → defer (not stop).
- **Score-gating**: a step restricted to categories the lead is not in is skipped.
- **Why-sent provenance**: each `send` event records a `why_sent` JSON
  (sequence, step, channel, template, enrolled score category, reason).
- **Suppressed**: a `send` event always has `will_send=false`.

UI: `/automations/sequences` (+ `/[id]`) with a banner stating follow-up sends are
recorded but never delivered while the master switch is off. Permission:
`followups.read` / `followups.manage`.

---

## 4. Site visits & calendar

`site_visits` follow an 8-state lifecycle (`requested → scheduled → confirmed →
in_progress → completed`, plus `cancelled / no_show / rescheduled`) enforced by
`canTransitionVisit`. `scheduleVisit` calls `detectDoubleBooking` against the
agent's existing `site_visits` + `calendar_busy_blocks` and **rejects on overlap**
before inserting (touching edges are not overlaps). `transitionVisitState` records
`visit_events`; `recordOutcome` writes `visit_outcomes` and resolves the terminal
state (attended → completed; absent → no_show).

Calendar is **simulation-only** (no Google OAuth — a Phase-7B/credential
stop-condition). `calendar_connections` stores metadata only; busy blocks mirror
visits for conflict detection.

UI: `/visits` (list, agent/day view, schedule form surfacing double-booking
conflicts, valid-transition controls, outcome capture). Permission:
`sitevisits.read` / `sitevisits.manage`.

---

## 5. Notifications

`createNotification` routes via `routeNotification` (in-app always; email/push only
for high/urgent or when enabled; quiet-hours defers external for non-urgent; muted
kinds dropped) and `dedupeNotifications`, then writes `notifications` +
`notification_deliveries`. External channels are recorded `simulated=true` (no live
email/push provider). Users read their **own** notifications (RLS on
`recipient_user_id = auth.uid()`); preferences are own-row.

UI: `/notifications` (list + mark read) and `/settings/notifications` (preferences).
Permission: `notifications.read` / `notifications.manage`.

---

## 6. Deferrals (see `TECH_DEBT.md`)

Live Google/Outlook calendar sync; real email/push notification delivery; real
WhatsApp/email follow-up delivery (all Phase-7B/5B.1 + credentials); production PGMQ
workers for scheduled automation/follow-up ticking (the services run synchronously
today via the durable-job abstraction); agent-scoped (vs tenant-scoped) RLS for
visits/automations.
