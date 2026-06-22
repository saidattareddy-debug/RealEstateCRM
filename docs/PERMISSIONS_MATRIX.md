# Permissions Matrix

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §5. Authorization is **permission-based**: roles are bundles of granular permission keys, and tenants may customize them. Per-user overrides live in `user_permissions`. This matrix is the source of truth for the default role→permission bundles and is enforced by tests ([`TEST_PLAN.md`](./TEST_PLAN.md)).

Scopes: **`global`** (platform-wide), **`tenant`** (whole tenant), **`team`** (manager's team), **`assigned`** (own assigned records).

---

## 1. Permission key catalog (representative)

| Domain               | Keys                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenants (platform)   | `platform.tenants.create`, `platform.tenants.suspend`, `platform.plans.manage`, `platform.health.read`, `platform.integrations.manage`, `platform.models.configure`, `platform.domains.manage`, `platform.billing.read`, `platform.impersonate` |
| Tenant settings      | `settings.branding.manage`, `settings.org.manage`, `settings.roles.manage`, `settings.integrations.manage`, `settings.security.manage`, `settings.retention.manage`, `settings.audit.read`                                                      |
| Users & team         | `users.invite`, `users.manage`, `agents.manage`, `agents.availability.manage`, `team.performance.read`                                                                                                                                          |
| Projects & inventory | `projects.read`, `projects.manage`, `inventory.read`, `inventory.manage`, `inventory.import`, `knowledge.manage`, `knowledge.approve`, `staledata.resolve`                                                                                      |
| Leads                | `leads.read.assigned`, `leads.read.team`, `leads.read.all`, `leads.create`, `leads.update`, `leads.assign`, `leads.reassign`, `leads.merge`, `leads.export`, `leads.classify.override`                                                          |
| Conversations        | `conversations.read.assigned`, `conversations.read.private`, `conversations.reply`, `conversations.takeover`, `conversations.transfer`                                                                                                          |
| Pipeline & sales ops | `pipeline.configure`, `pipeline.move`, `tasks.manage`, `calls.manage`, `sitevisits.read`, `sitevisits.manage`                                                                                                                                   |
| Scoring & automation | `scoring.read`, `scoring.edit`, `scoring.approve`, `scoring.publish`, `automations.manage`, `assignment.configure`                                                                                                                              |
| Marketing            | `campaigns.manage`, `sources.manage`, `forms.manage`, `attribution.read`, `analytics.marketing.read`                                                                                                                                            |
| Analytics            | `analytics.sales.read`, `analytics.agents.read`, `analytics.ai.read`, `analytics.cost.read`                                                                                                                                                     |
| Billing              | `billing.read`, `billing.manage`                                                                                                                                                                                                                |

> `leads.read.*` and `conversations.read.private` are intentionally separate so the Project Data & Maintenance role can manage content **without** access to private buyer conversations.

## 2. Role → capability matrix

Legend: ✅ full · 🟡 scoped/conditional · ➖ none.

| Capability                                              |  Super Admin  | Client Admin |    Marketing Mgr     |  Sales Mgr  | Sales Agent  | Project Data & Maint. |    Viewer    |
| ------------------------------------------------------- | :-----------: | :----------: | :------------------: | :---------: | :----------: | :-------------------: | :----------: |
| Create/suspend tenants, plans, domains, platform health |      ✅       |      ➖      |          ➖          |     ➖      |      ➖      |          ➖           |      ➖      |
| Configure default/platform AI models                    |      ✅       |      ➖      |          ➖          |     ➖      |      ➖      |          ➖           |      ➖      |
| Audited tenant impersonation                            |      ✅       |      ➖      |          ➖          |     ➖      |      ➖      |          ➖           |      ➖      |
| Manage tenant settings & branding                       |      ➖¹      |      ✅      |          ➖          |     ➖      |      ➖      |          ➖           |      ➖      |
| Manage integrations                                     |      ➖¹      |      ✅      |  🟡 (forms/sources)  |     ➖      |      ➖      |          ➖           |      ➖      |
| Manage roles & permissions                              |      ➖¹      |      ✅      |          ➖          |     ➖      |      ➖      |          ➖           |      ➖      |
| Invite users                                            |      ➖¹      |      ✅      |          ➖          | 🟡 (agents) |      ➖      |          ➖           |      ➖      |
| Manage campaigns & lead sources                         |      ➖       |      ✅      |          ✅          |     ➖      |      ➖      |          ➖           |      ➖      |
| Upload leads / imports                                  |      ➖       |      ✅      |          ✅          |     🟡      |      ➖      |          ➖           |      ➖      |
| View attribution & marketing analytics                  |      ➖       |      ✅      |          ✅          |     🟡      |      ➖      |          ➖           |      🟡      |
| Configure pipeline stages                               |      ➖       |      ✅      |          ➖          |     ✅      |      ➖      |          ➖           |      ➖      |
| Manage agents / availability                            |      ➖       |      ✅      |          ➖          |     ✅      |      ➖      |          ➖           |      ➖      |
| Configure assignment rules                              |      ➖       |      ✅      |          ➖          |     ✅      |      ➖      |          ➖           |      ➖      |
| Reassign / bulk reassign leads                          |      ➖       |      ✅      |          ➖          |     ✅      | 🟡 (request) |          ➖           |      ➖      |
| View leads                                              |      ➖       |  ✅ tenant   | 🟡 (marketing views) |   ✅ team   | 🟡 assigned  |          ➖           |   🟡 read    |
| Read **private** conversations                          |      ➖       |      ✅      |          ➖          | ✅ (review) | 🟡 assigned  |          ➖           |      ➖      |
| Reply / take over AI conversations                      |      ➖       |      ✅      |          ➖          |     ✅      | ✅ assigned  |          ➖           |      ➖      |
| Move pipeline stage / add notes / tasks                 |      ➖       |      ✅      |          ➖          |     ✅      | ✅ assigned  |          ➖           |      ➖      |
| Schedule & manage site visits                           |      ➖       |      ✅      |          ➖          |     ✅      | ✅ assigned  |          ➖           |   🟡 read    |
| Record outcomes / lost reasons                          |      ➖       |      ✅      |          ➖          |     ✅      | ✅ assigned  |          ➖           |      ➖      |
| Manage project content / pricing / inventory            |      ➖       |      ✅      |          ➖          |     ➖      |      ➖      |          ✅           |   🟡 read    |
| Upload brochures / floor plans / offers                 |      ➖       |      ✅      |          ➖          |     ➖      |      ➖      |          ✅           |      ➖      |
| Manage & approve knowledge base                         |      ➖       |      ✅      |          ➖          |     ➖      |      ➖      |          ✅           |      ➖      |
| Resolve stale-data warnings                             |      ➖       |      ✅      |          ➖          |     🟡      |      ➖      |          ✅           |      ➖      |
| Edit lead scoring rules                                 |      ➖       |      ✅      |  🟡 (with approval)  |     ✅      |      ➖      |          ➖           |      ➖      |
| **Approve/publish** scoring rules                       |      ➖       |      ✅      |          🟡          |     ✅      |      ➖      |          ➖           |      ➖      |
| Approve / override lead classification                  |      ➖       |      ✅      |          ➖          |     ✅      |      ➖      |          ➖           |      ➖      |
| Manage follow-up sequences/automations                  |      ➖       |      ✅      |    🟡 (marketing)    |     ✅      |      ➖      |          ➖           |      ➖      |
| View dashboards & reports                               | 🟡 (platform) |      ✅      |    🟡 (marketing)    |     ✅      |   🟡 (own)   |     🟡 (project)      | ✅ read-only |
| View AI usage & cost / billing                          |      ➖       |      ✅      |          ➖          |     🟡      |      ➖      |          ➖           |      🟡      |
| Read audit log                                          |      ➖¹      |      ✅      |          ➖          |     🟡      |      ➖      |          ➖           |      ➖      |

¹ Super Admin operates at platform scope and does **not** silently hold tenant-data permissions; tenant access requires the audited impersonation flow.

## 3. Critical isolation rules (test-enforced)

1. **Project Data & Maintenance cannot read private lead conversations** (`conversations.read.private` not granted). Test: maintenance user denied on `messages`/`conversations`.
2. **Sales Agent sees only assigned leads/conversations** unless granted `leads.read.team`/`.all`. Test: cross-agent read denied.
3. **Manual assignment is not silently overwritten** by automation — enforced in `domain` assignment logic + tested (see [`SCORING_ENGINE.md`] sibling logic and [`TEST_PLAN.md`]).
4. **Scoring publish** requires `scoring.publish`; Marketing Manager edits are gated by approval.
5. **Super Admin** has no cross-tenant data permission by default; impersonation is audited and time-limited.
6. **Viewer is strictly read-only** — no mutation permissions in any domain.

## 4. Customization

Tenants (Client Admin) can clone a default role, adjust its permission bundle, and assign it. Per-user exceptions use `user_permissions` (grant or revoke a single key). The default bundles above are seeded on tenant creation and remain the tested baseline.

## Phase 4 note (conversations)

Phase 4 added **no new permission keys** — it exercises the existing conversation
bundle. `conversations.read.private` (managers/admin) sees all tenant
conversations; `conversations.read.assigned` (agents) sees only their own.
`conversations.reply` / `takeover` / `transfer` gate the inbox actions. The
Project Data & Maintenance role holds **none** of these, so it cannot read private
buyer conversations — verified at runtime in the RLS harness, not only as a bundle
invariant. Consent/DNC writes reuse `leads.update`; widget configuration reuses
`settings.org.manage`.

## Phase 4.1 note (inbox completion)

18 new permission keys: `conversations.read.all/team/metadata`,
`conversations.assign/close/reopen/priority.manage/tags.manage/notes.create/
notes.manage/ai.resume/export`, `messages.redact`, `canned_replies.manage`,
`website_chat.manage`, `website_chat.view_sessions`, `consent.manage`,
`dnc.manage`. Client Admin gets all conversation keys (by pattern) plus the
non-conversation keys; Sales Manager runs the inbox (team scope + management);
Sales Agent stays **assigned-only** (notes.create, close/reopen, ai.resume,
tags.manage — **no** `read.metadata`); Marketing is **metadata-only**
(`conversations.read.metadata`, no content scope → sees rows, not message bodies).
Grants are applied to existing tenants and to new ones via
`grant_phase41_conversation_perms` (called from `on_tenant_created`). Consent/DNC
mutations require `consent.manage`/`dnc.manage`; redaction requires
`messages.redact`. All asserted in the RLS harness (166/166).

## Phase 4.1 final wiring (2026-06-19)

- Team create/assign reuse `assignment.configure` (no new permission). `conversations.assign` continues to gate per-conversation assignment/transfer/lock and owner-mismatch resolution.
- Canned-reply management uses `canned_replies.manage`; sending a canned reply goes through the standard reply path and therefore enforces `conversations.reply` plus consent/DNC/status/operating-mode/takeover.
- Tag management/bulk-tagging uses `conversations.tags.manage`. Saved inbox views reuse the existing `saved_views` model: own always visible, `tenant` to all members, `team` with `leads.read.team`; writes are owner-only.

## Phase 5A (2026-06-20)

Migration 0017 adds knowledge and AI permission keys (mirrored in `packages/validation/src/permissions.ts`) and grants them per role via `grant_phase5a_ai_perms`.

**Knowledge keys:** `knowledge.read`, `knowledge.create`, `knowledge.edit`, `knowledge.review`, `knowledge.approve`, `knowledge.archive`, `knowledge.conflicts.resolve`.

**AI keys:** `ai.settings.read`, `ai.settings.manage`, `ai.providers.manage`, `ai.prompts.manage`, `ai.test_lab.use`, `ai.runs.read`, `ai.feedback.create`, `ai.copilot.use`, `ai.shadow.manage`, `ai.usage.read`.

**Default role bundles:**

| Role                  | Knowledge                                                                             | AI                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `client_admin`        | full (read/create/edit/review/approve/archive/conflicts.resolve)                      | full (settings, providers, prompts, test-lab, runs, feedback, copilot, shadow, usage)                          |
| `sales_manager`       | `knowledge.read`                                                                      | `ai.settings.read`, `ai.runs.read`, `ai.test_lab.use`, `ai.copilot.use`, `ai.feedback.create`, `ai.usage.read` |
| `sales_agent`         | `knowledge.read`                                                                      | `ai.copilot.use`, `ai.feedback.create`                                                                         |
| `marketing_manager`   | `knowledge.read`                                                                      | `ai.usage.read`                                                                                                |
| `project_maintenance` | full knowledge management (read/create/edit/review/approve/archive/conflicts.resolve) | **none** — intentionally no `ai.runs.read` (no lead/conversation content)                                      |
| `viewer`              | `knowledge.read`                                                                      | none                                                                                                           |

The matrix is enforced by RLS policies (each table's select/insert/update gated on the relevant key) and by the provisioning function for new and backfilled tenants.

## Phase 6A (2026-06-20)

Migration 0021 adds 8 deterministic-scoring permission keys (mirrored in `packages/validation/src/permissions.ts`) and grants them per role on tenant creation and backfill. Scoring is **advisory / record-only** — these permissions gate reading, running, overriding, and managing the scoring model; none of them can change a lead's stage, assignment, status, or conversation mode, or send anything.

**Scoring keys:** `scoring.read`, `scoring.run`, `scoring.override`, `scoring.models.read`, `scoring.models.manage`, `scoring.models.approve`, `scoring.signals.manage`, `scoring.evaluation.use`.

**Default role bundles:**

| Role                  | Scoring                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `client_admin`        | full (read, run, override, models.read, models.manage, models.approve, signals.manage, evaluation.use)   |
| `sales_manager`       | `scoring.read`, `scoring.run`, `scoring.override`, `scoring.models.read`, `scoring.evaluation.use`       |
| `sales_agent`         | `scoring.read`                                                                                           |
| `marketing_manager`   | aggregate/distribution read only (`scoring.read` scoped to aggregate views; no per-lead override/manage) |
| `project_maintenance` | **none** — no lead-scoring access (no lead/conversation content)                                         |
| `viewer`              | `scoring.read` where granted (read-only; no run/override/manage)                                         |

The Platform Super Admin holds **no** scoring keys and has no silent cross-tenant scoring access; tenant scoring data is reachable only through the audited impersonation flow. The matrix is enforced by RLS on each of the 14 scoring tables (select/insert/update/delete gated on the relevant key) and by the per-tenant provisioning grant.

## Phase 6B (2026-06-20)

Migration 0022 adds 8 deterministic-matching permission keys (mirrored in `packages/validation/src/permissions.ts`) and grants them per role on tenant creation and backfill. Matching is **advisory / record-only** — these permissions gate reading, running, overriding, giving feedback on, and managing the matching model; none of them can assign a lead, change a lead's stage, status, or score, reserve inventory, or send anything.

**Matching keys:** `matching.read`, `matching.run`, `matching.override`, `matching.feedback.create`, `matching.models.read`, `matching.models.manage`, `matching.models.approve`, `matching.evaluation.use`.

**Default role bundles:**

| Role                  | Matching                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `client_admin`        | full (read, run, override, feedback.create, models.read, models.manage, models.approve, evaluation.use)     |
| `sales_manager`       | `matching.read`, `matching.run`, `matching.override`, `matching.feedback.create`, `matching.evaluation.use` |
| `sales_agent`         | `matching.read`, `matching.feedback.create`                                                                 |
| `marketing_manager`   | aggregate/distribution read only (no per-lead override/manage)                                              |
| `project_maintenance` | manages project data but **no private-lead matching** — no access to per-lead match runs/candidates         |
| `viewer`              | `matching.read` where granted (read-only; no run/override/feedback/manage)                                  |

The Platform Super Admin holds **no** matching keys and has no silent cross-tenant matching access; tenant matching data is reachable only through the audited impersonation flow. The matrix is enforced by RLS on each of the 14 matching tables (select/insert/update/delete gated on the relevant key) and by the per-tenant provisioning grant. The Phase 5B.1 external stop-line is preserved — matching is advisory-only and automatic customer sending remains impossible.

## Phase 7A additions (external integration foundation)

Phase 7A adds **16** integration permission keys: `integrations.read`,
`integrations.manage`, `integrations.credentials.manage`,
`integrations.events.read`, `integrations.events.replay`,
`integrations.health.read`, `integrations.mappings.manage`,
`channels.whatsapp.read`, `channels.whatsapp.manage`,
`channels.whatsapp.templates.manage`, `channels.whatsapp.test`,
`channels.email.read`, `channels.email.manage`, `channels.email.rules.manage`,
`channels.email.test`, and `channels.human_send.simulate`. The
`human_send.simulate` key authorises only a **simulation** — no message is ever
sent (Phase 7A performs no external IO; the frozen safety switches are preserved).

Role defaults per Phase 7A §33 (from the per-tenant provisioning grant):

| Role                  | Integration permissions                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client_admin`        | **full** — all 16 keys (manage connections + credentials, events read + replay, health, mappings, every WhatsApp/email key, and `channels.human_send.simulate`)                                                                                              |
| `sales_manager`       | `integrations.read`, `integrations.events.read`, `integrations.health.read`, `channels.whatsapp.read`, `channels.whatsapp.test`, `channels.email.read`, `channels.email.test`, `channels.human_send.simulate` (health / events / test + human-send simulate) |
| `sales_agent`         | `channels.human_send.simulate` **only** (human-send simulate only)                                                                                                                                                                                           |
| `marketing_manager`   | `integrations.mappings.manage`, `integrations.health.read` (mappings + health)                                                                                                                                                                               |
| `project_maintenance` | **none**                                                                                                                                                                                                                                                     |
| `viewer`              | read where granted (read-only; no manage / replay / simulate)                                                                                                                                                                                                |

The Platform Super Admin holds **no** integration keys and has **no silent
access**; tenant integration data is reachable only through the audited
impersonation flow. The matrix is enforced by RLS on each of the 33 integration
tables (config writes gated on `integrations.manage`; event tables read-only to
clients via `integrations.events.read` with writes server-role only; human
outbound insert gated on `channels.human_send.simulate`) and by the per-tenant
provisioning grant. See [`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md) and
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md).
