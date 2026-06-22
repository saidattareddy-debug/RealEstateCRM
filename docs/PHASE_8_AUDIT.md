# Phase 8 Audit — Automations & Visits

Evidence-based verification of Phase 8. Status: **Locally Complete & Verified**;
customer sending remains **impossible by construction**; live calendar/notification
delivery deferred (credential stop-conditions).

## Deliverables vs. exit criteria (`IMPLEMENTATION_PLAN.md` Phase 8)

| Exit criterion                                                        | Status                          | Evidence                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow/automation engine + editor                                   | ✅                              | `automation.ts` + `automations/service.ts` (`runAutomationForEvent`) + `/automations`, `/automations/[id]`                             |
| Score-aware follow-up sequences with all stop conditions + "why sent" | ✅                              | `followup.ts` (`decideFollowUpStep`, 9 stop reasons, quiet-hours, why_sent) + `followups/service.ts` + `/automations/sequences`        |
| Follow-ups stop correctly                                             | ✅                              | `followup.test.ts` (every stop condition) + `followup_step_events.stop_reason`                                                         |
| Calendar sync + double-booking prevention                             | ✅ (simulated)                  | `visits.ts` `detectDoubleBooking` + `visits/service.ts` `scheduleVisit` rejects overlap; live Google sync deferred                     |
| Site-visit module (full lifecycle)                                    | ✅                              | `visits.ts` 8-state machine + `transitionVisitState`/`recordOutcome` + `/visits`                                                       |
| Notifications delivered                                               | ✅ (in-app; external simulated) | `notifications.ts` `routeNotification` + `notifications/service.ts` `createNotification` + `/notifications`, `/settings/notifications` |
| Stop-condition: live credentials                                      | ✅ honored                      | calendar simulation-only; no external IO; switches frozen                                                                              |

## Safety invariants (verified)

- **No customer send.** `automation_run_actions.will_send` + `followup_step_events.will_send`
  are `not null default false check (will_send = false)` — proven by
  `pg-phase8.pg.test.ts` (insert `will_send=true` rejected). Domain proven by
  `automation.test.ts` / `followup.test.ts` (`willSend` always false). Services record
  `status='suppressed'`.
- **Calendar simulation-only.** `calendar_connections.status` CHECK rejects
  `connected` (harness). No network IO (`verify:no-external-io` clean).
- **External notifications simulated.** `notification_deliveries` CHECK: non-`in_app`
  requires `simulated=true` (harness); `phase8-services.web.test.ts` asserts the email
  delivery row is `simulated=true`.
- **Tenant isolation + permission gating.** `pg-phase8.pg.test.ts`: all 16 tables
  RLS-enabled; tenant B cannot read tenant A automations; a role without
  `automations.manage` cannot insert.
- **Switches frozen.** `LIVE_SEND_MASTER_SWITCH`, `RESPONDER_LIVE_SENDING`, public
  webhooks, live-provider activation — all unchanged.

## Gates (executed on the sandbox copy)

format ✅ · lint 0-err ✅ · typecheck ✅ (all 5 projects) · **406 unit** ✅ (+40 Phase 8
domain) · **56 web** ✅ (+4 Phase 8 services) · **embedded-PG harness: pg-phase8 9/9** ✅
(migrations 0001–0029 + seed) · migration-order 0029 ✅ · secret-scan ✅ ·
no-external-IO ✅.

## Documented deferrals (`TECH_DEBT.md`)

Live Google/Outlook calendar sync; real email/push + WhatsApp/email follow-up
delivery (Phase 7B/5B.1 + credentials); production PGMQ workers for scheduled
ticking; agent-scoped RLS for visits/automations (currently tenant + permission).
