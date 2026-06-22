# Page Map

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §24–26. Every page below is a **working** page backed by real data and actions — no placeholders (§35). Each must implement the four required states: **loading, error, empty, permission-denied** ([`UI_SYSTEM.md`](./UI_SYSTEM.md)).

Route prefixes: authenticated app under `/(app)`, platform admin under `/(platform)`, public surfaces under `/(public)`.

---

## 1. Authentication & onboarding (`/(public)` / `/auth`)

- Sign in (tenant-branded) · Password reset · Invitation acceptance · MFA setup (where enabled).

## 2. Dashboard (`/dashboard`)

KPI cards backed by real aggregates: total/new/hot/warm/cold/disqualified leads, average score, qualification rate, first-response time, site visits scheduled/completed, no-show rate, bookings, conversion rate, cost per lead / qualified lead / site visit, source & campaign performance, project demand, agent workload & performance, AI-handled conversations, human takeovers, AI escalation rate, follow-up health, lost reasons, inventory-interest trends, duplicate/broker-overlap metrics. Filterable.

## 3. Leads

- `/leads` — all leads (TanStack table, saved filters, bulk actions, export).
- Views: Hot · Unassigned · Needs review · Dormant · Disqualified · Duplicate review queue.
- `/leads/:id` — lead detail: identity; score + category + explanation; qualification completeness; source & campaign; attribution timeline; assigned agent; project & inventory matches; conversation; notes; tasks; calls; site visits; files; stage history; score history; automation history; consent/opt-out status; audit events. (Mobile: sticky Call/WhatsApp/Note/Stage/Visit actions.)

## 4. Conversation inbox (`/inbox`)

Shared inbox · agent inbox · unassigned · AI-active · human-takeover · needs-response · SLA-breached. Search + filters. Conversation panel + lead-context panel + AI summary + suggested reply + **source-evidence** panel + transfer conversation + take over from AI.

## 5. Pipeline (`/pipeline`)

Kanban · Table · Funnel analytics. Drag between stages (audited, SLA recalculated, automations triggered, optional reason required).

## 6. Projects (`/projects`)

- `/projects` — list.
- `/projects/:id` — project dashboard · editor · media · amenities · pricing · offers · documents · FAQs · knowledge status.

## 7. Inventory (`/inventory`)

Unit table · availability · price history · bulk editor · imports · stale-data report. Statuses: Available/Temporarily held/Reserved/Booked/Sold/Blocked/Unavailable.

## 8. Site visits (`/site-visits`)

Calendar · upcoming · completed · no-shows · agent schedule. Full lifecycle (confirm/remind/reschedule/cancel/complete/outcome/follow-up).

## 9. Tasks (`/tasks`)

My tasks · team tasks · overdue · calls · follow-ups.

## 10. Campaigns & sources (`/campaigns`, `/sources`)

Campaign dashboard · lead-source dashboard · UTM analysis · portal analysis · cost & conversion metrics.

## 11. Automations (`/automations`)

Automation list · visual workflow editor · follow-up sequences · execution history · failure queue (DLQ + replay).

## 12. Lead scoring (`/scoring`)

Current rule set · visual rule builder · rule versions · simulation (historical) · score distribution · conversion analysis.

## 13. Knowledge base (`/knowledge`)

Documents · upload · processing · review · approval · expired content · search tester · AI-answer tester.

## 14. Analytics & reports (`/analytics`)

Marketing · sales · agents · projects · site visits · conversations · AI performance · cost & usage · lost reasons. Custom date range + export. Filterable by tenant/date/project/source/campaign/agent/category/configuration/lead category.

## 15. Team (`/team`)

Users · roles (permission editor) · agents · workload · availability · performance.

## 16. Integrations (`/integrations`)

WhatsApp · Gmail · Google Calendar · Meta · Google Ads · generic webhooks · API keys · integration health · logs.

## 17. Billing & usage (`/billing`)

Plan · limits · AI usage · WhatsApp usage · storage · active users · exportable usage report.

## 18. Settings (`/settings`)

Branding · organisation · projects · pipeline · custom fields · working hours · quiet hours · languages · notifications · scoring · assignment · data retention · security · audit log.

## 19. Platform admin (`/(platform)` — Super Admin)

Tenants (create/suspend) · plans & limits · platform health · default AI models · custom domains · platform integrations · usage & billing · audited impersonation.

## 20. Public surfaces

- `/forms/:tenant/:formId` — website lead-form endpoint.
- Embeddable **chat widget** (script + iframe) — tenant-identified, UTM-aware.

---

## Global search & filtering (cross-page, §26)

Global command palette searches leads (name/phone/email), projects, units, agents, conversation content, notes, sources, campaigns — all tenant-scoped. Lead filters: score, category, stage, project, property category, configuration, budget, timeline, source, campaign, agent, last activity, created date, site-visit status, qualification completeness, language, lost reason, tags. Saved & shareable team views everywhere a list appears.

## Required state coverage (every page)

| State             | Behaviour                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Loading           | Skeletons/spinners, never layout jump                                                                |
| Empty             | Helpful empty state with primary action                                                              |
| Error             | Recoverable error with retry, logged to Sentry                                                       |
| Permission-denied | Explicit denied view (not a blank/404) respecting [`PERMISSIONS_MATRIX.md`](./PERMISSIONS_MATRIX.md) |

## Phase 3.1 page changes (lead detail)

`/leads/[id]` now also renders, permission-gated and backed by real data:

- **Qualification completeness** panel (overall / required / important meters +
  missing-field lists) — an information metric, not a quality score.
- **Calls** panel — log-call form (direction, status, duration, outcome, notes,
  optional callback → task) + call history. No telephony integration.
- **Pipeline** — moving into a Lost/Disqualified stage requires a reason
  (enforced server-side).
- **Mobile sticky action bar** — Call (`tel:`), WhatsApp (**external `wa.me` link
  only**), Note, Task, Stage anchors.

Deferred surfaces (DB + RLS exist; UI later — see `PHASE_3_1_AUDIT.md` §4): saved-view
apply/duplicate/set-default/share UI, lead custom-field admin UI, and the
qualification-completeness badge on the list and pipeline-card surfaces.

## Phase 4 pages (Conversations)

- `/inbox` — conversation list with filters (All / My inbox / Unassigned /
  AI-active / Human takeover / Needs response / Closed); each row shows channel,
  an AI/Human badge, and a needs-response/overdue badge. All four states.
- `/inbox/[id]` — message thread, reply box, lead-context panel, latest summary,
  event log, and take-over / resume / transfer / close / generate-summary
  controls (each permission-gated). Closed conversations hide the reply box.

Inbox is now a live item in the desktop sidebar and the mobile bottom nav
(`conversations.read.assigned`). The website chat widget is an embeddable script
(public key) — not a hosted page. Realtime live-push and AI-suggested replies are
deferred (see [`CONVERSATIONS.md`](./CONVERSATIONS.md)).

## Phase 4.1 page changes (in progress)

`/inbox/[id]` adds operating-mode controls (Take over / End takeover — never
activates AI), a status/priority OpsBar (with history recorded), and an
**Internal notes** panel (visibility-scoped, never customer-facing). The header
shows lifecycle / priority / operating-mode / waiting-on. Planned inbox surfaces —
tag filter + management, canned-reply composer + settings page, assignment/
transfer/SLA/history panels, unread badges, the mobile inbox sheets, the website
chat install page (`/settings/channels/website-chat/[widgetId]/install`) and
`/chat/demo` — are tracked in [`TECH_DEBT.md`](./TECH_DEBT.md).

## Phase 4.1 final wiring (2026-06-19)

New pages: `/settings/canned-replies` (canned-reply management) and `/settings/tags` (tag management), both reachable from the inbox header for permitted roles. `/inbox` gains a saved-views bar, tag filter, and real SLA chips; `/inbox/[id]` renders the live polling thread, the interactive assignment + owner-mismatch controls, and a mobile action sheet. The website widget (`/chat/widget/[widgetId]`) reports unread to its embed launcher.

## Phase 5A (2026-06-20)

New AI/knowledge pages under `app/(app)`:

- **`/knowledge`** — knowledge source list with state badges (`knowledge.read`).
- **`/knowledge/new`** — create a source via the ingestion form (manual text / markdown / FAQ / project record / document URL) (`knowledge.create`).
- **`/knowledge/[sourceId]`** — source detail with version history and lifecycle controls (draft new version, approve, reject, supersede, rollback, archive) gated per lifecycle permission.
- **`/knowledge/review`** — the review queue of `review_required` sources for approvers.
- **`/settings/ai`** — AI settings hub, with sub-pages **providers**, **models**, **prompts** (versioned, explicit activation), **policies** (operating level + escalation/language policy), and **usage** (token/cost limits).
- **`/ai/test-lab`** — run the pipeline against synthetic input and inspect grounding/escalation/retrieval/citation traces (`ai.test_lab.use`).
- **Inbox copilot panel** (`inbox/[id]/copilot.tsx`) — generate an agent-facing draft, accept/edit/discard, and preview a deterministic summary. A persistent banner makes clear nothing is sent automatically; sending requires the agent's explicit action and re-runs consent/DNC/status checks (`ai.copilot.use`).

## Phase 6A (2026-06-20)

New deterministic-scoring surfaces. All are **advisory / record-only** — nothing here changes a lead's stage, assignment, status, or conversation mode, and nothing sends.

- **`/settings/scoring`** (and sub-pages — models, signals, evaluation) — the scoring model hub: model/version list with status badges (draft/pending_approval/active/retired), a version's rule groups and rules (read-only on an active version; edits require drafting a new version), signal-definition management, and the evaluation dataset/cases. Permission-gated per action (`scoring.models.read` / `scoring.models.manage` / `scoring.models.approve` / `scoring.signals.manage` / `scoring.evaluation.use`).
- **Lead scoring panel** (on `/leads/[id]`, `scoring.read`) — the calculated score, classification, contributing rules/components, missing signals, stale evidence, evidence completeness and calculation confidence (shown separately from the score), the score-history timeline, and any active manual override (effective vs calculated). Override controls require `scoring.override`; recalculate requires `scoring.run`.
- **`/scoring/test-lab`** (`scoring.evaluation.use` / `scoring.run`) — run the deterministic model against synthetic observations and inspect the full explanation (components, applied/skipped rules, classification, completeness/confidence). Record-only; produces no customer-facing effect.

Lead lists and filters gain scoring filters (classification, score range, review-required, disqualified, missing-evidence). All four required states apply.

## Phase 6B (2026-06-20)

New deterministic-matching surfaces. All are **advisory / record-only** — nothing here assigns a lead, changes a lead's stage, status, or score, reserves inventory, or sends anything.

- **`/settings/matching`** (and sub-pages) — the matching model hub: model/version list with status badges (draft/pending_approval/active/retired), a version's rule groups and rules with a **draft rule editor** (read-only on an active version; edits require drafting a new version), and the evaluation dataset/cases. Permission-gated per action (`matching.models.read` / `matching.models.manage` / `matching.models.approve` / `matching.evaluation.use`).
- **Lead matching panel** (on `/leads/[id]`, `matching.read`) — the ranked candidates with, per candidate, classification, score, the three match levels (project / configuration / unit), inventory state (a unit shown as confirmed only when `verified_available`), budget outcome, match confidence and preference completeness (shown separately from the score), the per-rule components and reasons, and effective vs calculated rank. Override controls require `matching.override`; feedback requires `matching.feedback.create`; recalculate requires `matching.run`.
- **`/matching/test-lab`** (`matching.evaluation.use` / `matching.run`) — run the deterministic model against synthetic preferences/candidates in **TEST MODE — NO LEAD, PROJECT OR INVENTORY UPDATED**, and inspect the full explanation (eligibility gates, components, classifications, inventory states, budget outcomes, completeness/confidence). Record-only; produces no customer-facing effect.
- **Project-side "potentially matching leads"** (on `/projects/[id]`, permission-scoped) — a read-only, advisory view of leads that could match the project, gated on matching read permission; surfaces no private-lead content to roles without per-lead matching access (Project Maintenance has none).

All four required states apply. The Phase 5B.1 external stop-line is preserved — automatic customer sending remains impossible, and scoring and matching are advisory-only.

## Phase 7A — external integration foundation

New integration surfaces. Every page is **record-only** and performs **no
external IO** — nothing here connects to a live provider or sends a customer-facing
message; all data shown is **mock / simulation / synthetic**. The frozen safety
switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
outbox, automatic customer sending impossible). The exact component/file inventory
is reconciled by the parent agent.

- **`/settings/integrations`** (and sub-pages, e.g. a connection detail, channel
  config, WhatsApp accounts/numbers/templates, email mailboxes/parsing rules,
  source mappings) — the integration hub. Connections show a status badge but can
  never be `connected` (DB CHECK) and health is never `healthy` on config alone.
  Permission-gated per action (`integrations.read` / `integrations.manage` /
  `integrations.credentials.manage` / `integrations.mappings.manage` and the
  channel keys). A rep-initiated send here is a **simulation only**
  (`channels.human_send.simulate`).
- **`/integrations/events`** — the external-event log: normalized events with
  status, attempts, failures, dead-letters, and replay (read gated on
  `integrations.events.read`; replay on `integrations.events.replay`). Every row
  is a synthetic event; none originates from a live provider.

All four required states apply. Live provider activation is **Phase 7B**. See
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md) and
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md).
