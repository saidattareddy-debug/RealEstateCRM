# Security

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §5, §28. Security is non-negotiable. This document defines the authorization model, RLS strategy, secret handling, webhook/AI defenses, and the privacy controls. The role→permission matrix lives in [`PERMISSIONS_MATRIX.md`](./PERMISSIONS_MATRIX.md).

---

## 1. Authentication

- Supabase Auth for sessions; secure, HTTP-only cookies; session expiration and refresh.
- **Optional MFA (TOTP)** per tenant policy; enforced for Client Admin / Super Admin where enabled.
- Login security events (`security_events`): success, failure, new device, password reset, MFA changes.
- Invitation-based onboarding (`invitations`) with expiring, single-use tokens.

## 2. Authorization — permissions, not role names

- Authorization is checked against **granular permission keys** (e.g. `leads.read.assigned`, `leads.reassign`, `scoring.publish`, `conversations.read.private`), not role labels. Roles are bundles of permissions; tenants may customize them.
- **Effective permissions** = role permissions ⊕ `user_permissions` (per-user grants/revocations).
- Every server action and route handler performs an explicit `(tenant, permission)` check before reading/mutating — RLS is the backstop, not the only gate.
- **Least privilege by design:** the _Project Data & Maintenance_ role has project/inventory/knowledge permissions but **not** `conversations.read.private`. Sales Agents see only assigned leads unless granted broader scope.

## 3. Row-Level Security (RLS) strategy

### 3.1 Principles

- RLS is **enabled on every tenant-owned table**; default-deny.
- Policies derive the tenant from a trusted source: the authenticated user's membership, surfaced via JWT claim and/or a Postgres session GUC (`request.tenant_id`) set by middleware/`SET LOCAL`. Client-supplied `tenant_id` is never trusted.
- Policies layer **tenant isolation** + **row-level scope** (e.g. agent sees assigned leads) + **operation** (select/insert/update/delete).

### 3.2 Canonical policy shape (illustrative)

```sql
-- Every tenant table: baseline isolation
create policy tenant_isolation on leads
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Scope refinement for a limited role (checked via permission helper)
create policy agent_sees_assigned on leads for select
  using (
    tenant_id = current_tenant_id()
    and (
      has_permission('leads.read.all')
      or exists (
        select 1 from lead_assignments la
        where la.lead_id = leads.id and la.agent_id = current_profile_id()
      )
    )
  );
```

- `current_tenant_id()`, `current_profile_id()`, `has_permission(text)` are `security definer` SQL helpers reading the verified session context.
- **Private conversations:** `messages`/`conversations` policies require `conversations.read.private` or assignment, explicitly excluding the maintenance role.
- **Platform tables** (`tenants`, `feature_flags`, `subscriptions`) have super-admin-only policies.

### 3.3 Testing (mandatory)

Every RLS policy has automated pgTAP/SQL tests proving: (a) a user of tenant A cannot read/write tenant B rows; (b) role-scoped access (agent vs manager) is enforced; (c) the maintenance role cannot read private conversations; (d) anon/service contexts behave as intended. No phase that adds tables is complete with failing RLS tests. See [`TEST_PLAN.md`](./TEST_PLAN.md).

## 4. Secrets and keys

- **No service-role key in browser code.** Service-role operations run only server-side / in Edge Functions.
- **No provider secret in browser code** (AI keys, WhatsApp tokens, Google OAuth secrets). Provider tokens are stored server-side encrypted; only **metadata** lives in `integration_credentials_metadata`.
- Public/anon keys are the only Supabase keys shipped to the client, with RLS as the enforcement layer.
- Env vars validated at boot via `packages/config` (Zod); missing/invalid secrets fail fast. Secret scanning in CI.

## 5. Super Admin & impersonation

- Super Admin manages tenants, plans, domains, platform health — but has **no silent cross-tenant data path** through client code.
- **Support impersonation** is an explicit, time-limited, fully audited flow: it creates a `security_event` + `audit_log`, shows a persistent banner in the impersonated session, and auto-expires. Read/write scope during impersonation is logged.

## 6. Input, output & transport hardening

- **Input validation** with Zod at every boundary (forms, API, webhooks, AI structured outputs).
- **Output encoding** / safe rendering to prevent XSS; React escaping + sanitization of any rendered rich text.
- **CSRF protection** on cookie-authenticated mutations; same-site cookies.
- **Security headers** (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors) via middleware.
- **Rate limiting** on auth, public API, webhooks, and the chat widget; bot-abuse protection on the widget.

## 7. Webhooks & idempotency

- Verify authenticity of every inbound webhook (Meta signature, provider HMAC, shared secret) before processing.
- Persist the raw event, compute an **idempotency key**, and dedupe via `idempotency_keys` so retries never double-create leads or double-send messages.
- Outbound sends are idempotent and respect `do_not_contact_entries`, consent, working/quiet hours, and WhatsApp session/template rules.

## 8. File uploads

- Validate type, size, and extension; store in tenant-prefixed Storage paths; serve via signed URLs gated by permission.
- A **malware-scanning integration point** is included in the ingestion pipeline (pluggable scanner) before documents are indexed or shared.

## 9. AI-specific security

- **Prompt-injection defense:** uploaded documents and website text are **untrusted content**. The system treats them as reference data only and ignores any instructions embedded in them. System prompts isolate untrusted content; retrieval context is clearly delimited and never executed as instructions.
- **AI-output validation:** all structured model outputs are Zod-validated; malformed/unsafe outputs are rejected and trigger fallback or escalation. The model can never write the official score or alter inventory facts directly.
- **Grounding:** customer-facing project answers come only from Approved knowledge/inventory; absence of an approved source forces escalation, not invention.

## 10. Privacy, PII & retention

- **PII masking by permission** (e.g. phone/email partially masked for low-privilege viewers; full access logged).
- **Export logging:** every data export is recorded (who/what/when) in `audit_logs`.
- **Data-deletion workflows** and configurable **retention policies** per tenant; do-not-contact and opt-out are permanent and enforced.
- Logs redact secrets and unnecessary PII (§32).

## 11. Auditing & monitoring

- `audit_logs` capture sensitive mutations (merges, reassignments, score-rule publishes, role/permission changes, exports, impersonation).
- `security_events` capture auth and access anomalies; alerting hooks notify on suspicious patterns.
- Dependency scanning and secret scanning run in CI (GitHub Actions).

## 12a. Phase 1.1 additions

- **Audit logging:** application-level `audit_logs` (append-only) and `security_events` now exist, with RLS and tests. Full design in [`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md). Secrets are redacted before storage; sign-in records hold the email only.
- **Super Admin — no silent tenant-data access (corrected):** RLS `SELECT` policies for `tenant_branding`, `tenant_settings`, `tenant_features`, `roles`, `role_permissions`, `memberships`, `audit_logs`, `security_events` were tightened to remove `is_platform_admin()`. The platform admin retains access only to the `tenants` registry and **platform-scope** (`tenant_id null`) audit rows; tenant data is reachable only via the audited impersonation model. Verified by `supabase/tests/0002_rls_full_coverage_test.sql` and the local harness (platform admin sees 0 tenant branding / 0 tenant audit rows).
- **Forged / missing active-tenant claims:** tests confirm a forged `app_metadata.active_tenant` grants no access (policies use `is_active_member`, not the claimed tenant) and a missing claim yields `has_permission = false`.
- **CI security steps:** secret scan (`scripts/secret-scan.mjs`) over the built client bundle + source, migration-order validation, and the pgTAP RLS suite run in CI ([`DEPLOYMENT.md`](./DEPLOYMENT.md)).

## 12. Definition of "secure enough to ship a phase"

A phase that introduces tenant tables or external surfaces is not done until: RLS enabled + tested on new tables; permission checks on new server operations; no secret reachable from the browser; new webhooks signature-verified + idempotent; new inputs Zod-validated; relevant security tests green.

## Phase 3.1 additions (ingestion & CRM)

- **Idempotency is database-enforced.** `lead_ingestion_events` carries a unique
  `(tenant_id, idempotency_key)` and a partial unique
  `(tenant_id, source_id, external_event_id)`; the app translates `23505` into an
  idempotent hit or a rejection. Concurrent/duplicate deliveries cannot duplicate
  downstream rows. HTTP ingestion routes persist the event **before** processing.
- **Ingestion auth.** `/api/v1/leads` uses a hashed api-key with **constant-time**
  comparison (`safeEqualHex`); `/webhooks/leads/[source]` accepts a hashed api-key
  or an HMAC signature. Both enforce a timestamp tolerance window and per-key/source
  rate limits, and return versioned, **non-disclosing** errors.
- **Public forms.** `/api/forms/[formId]` enforces an origin allow-list, request-size
  cap, rate limiting, a timestamp replay window, a honeypot (silent 202), and consent
  capture. It **never reveals whether a phone/email already exists** and never exposes
  internal tenant IDs or database errors.
- **Calls RLS — per-command write policies.** A call is visible **only if its lead is
  visible**. The write policy is split into `calls_insert` / `calls_update` /
  `calls_delete` so a `FOR ALL` policy cannot widen `SELECT` past the lead-visibility
  rule (this exact bug was caught by the RLS harness and fixed).
- **Saved views never widen RLS.** Saved views store presentation state only; the
  underlying lead RLS still applies. Sharing beyond `private` requires
  `leads.read.team`; only the owner can edit a view.
- **Secure export.** `/leads/export` is RLS- and permission-scoped, row-capped, and
  audited; CSV values beginning with `=`, `+`, `-`, `@`, tab, or CR are apostrophe-
  prefixed to neutralise spreadsheet formula injection. No raw payloads, secrets, or
  internal RLS values are exported.
- **Untrusted input.** Provider payloads and form submissions are treated as data,
  never instructions; all structured boundaries are Zod-validated.

## Phase 4 additions (conversations)

- **Conversation isolation.** `conversations.read.private` sees all tenant
  conversations; `read.assigned` sees only the agent's own (assigned conversation
  or assigned lead). Project Data & Maintenance has neither and is denied — a
  tested role-bundle invariant. Child tables (messages, summaries, events,
  participants) inherit visibility, and writes are split per-command so a
  `FOR ALL` policy cannot widen `SELECT`.
- **Consent / DNC enforced before outbound.** Every reply checks
  `contact_consents` via `isContactable`; a `revoked` or `do_not_contact` record
  for the channel (or `any`) blocks the send. Consent changes require
  `leads.update` and are audited (`consent.update`, security-flagged).
- **Human takeover pauses AI.** Takeover sets `ai_active = false`; the future
  (Phase 5) responder must not answer while a human holds the conversation.
- **Website chat endpoints** are public but hardened (origin allow-list, size
  cap, rate limit, timestamp window, honeypot, consent) and **non-disclosing**:
  they never reveal whether a contact exists, and never expose tenant/lead/
  conversation IDs or DB errors. Widget config holds only a public embed key; the
  service role is used server-side only.

## Phase 4.1 additions (AI safety & inbox)

- **Hard AI execution boundary.** `canExecuteAutomatedReply` is the single guard
  for any automated reply; `AI_RESPONDER_INSTALLED` is a compile-time `false`, so
  it **always denies** before Phase 5 — a database flag alone can never activate
  AI. There are no scattered AI checks. The Resume control can only set
  `human`/`paused` (`resumeTargetMode` never returns `ai`). A failed gate yields
  no customer-visible message. See [`HUMAN_TAKEOVER.md`](./HUMAN_TAKEOVER.md).
- **Metadata-only access.** `conversations.read.metadata` sees conversation rows
  but **not** message bodies or internal notes (content `SELECT` requires a
  content read scope). Agents are not granted `read.metadata` and stay
  assigned-only.
- **Per-user read state.** A user may write only their own `conversation_reads`
  row (RLS `profile_id = auth.uid()`), so reading never marks read for others.
- **Redaction.** Only `messages.redact` may redact; the audit stores a hash of
  the original, never the text; the body is replaced in place.
- **Message idempotency.** Inbound is DB-deduped (`message_ingestion_events`
  unique constraints); repeated/concurrent events cannot duplicate messages,
  unread, events, audit, lead associations, or SLA events.
- **Website trust model.** The browser is never trusted for internal ids; the
  signed-session model (`website_chat_sessions`, hashed token + version + expiry)
  resolves ids server-side. Public responses stay non-disclosing.
- **DNC before outbound.** Every reply checks `do_not_contact_entries` /
  consent; blocked sends show the reason. No legal assumption is hardcoded.

## Phase 4.1 final wiring (2026-06-19)

- Canned-reply variables are resolved **server-side** against a fixed allow-list (`resolveCannedReply`); unknown variables, HTML, JS and templating are rejected. The audit trail records only the canned-reply id, never the resolved message body.
- Saved inbox views and tag filters apply **after** RLS and conversation visibility; they can only narrow, never widen, what a user can see.
- Visitor read acknowledgement is bound to the signed session, widget and conversation; expired/rotated/cross-session tokens cannot acknowledge. The launcher unread channel is same-origin `postMessage` only.
- New tables (`teams`, `team_members`, `canned_reply_usage_events`) are tenant-scoped with per-command RLS; team management requires `assignment.configure`. Service-role usage remains confined to `lib/supabase/admin.ts`.

## Phase 5A (2026-06-20)

Phase 5A introduces the AI/knowledge subsystem. Its safety model is documented in full in [`AI_SECURITY.md`](./AI_SECURITY.md); the key points:

- **No automatic send.** A single boundary, `evaluateAiExecution` (`packages/domain/src/ai-guard.ts`), governs every AI path. `automatic` mode is always denied (`phase_5b_automatic_responder_not_enabled`), `maySendAutomatically` is the literal `false`, and `ai_runs` carries `check (mode <> 'automatic')`. The orchestrator and AI server actions never insert a message, deliver, or mutate conversation state; sending an edited copilot draft is a separate human action through `sendReplyAction`, which re-checks reply-permission/consent/DNC/status/takeover.
- **Secrets server-only.** Provider configuration stores only a `secret_ref` (env-var name), never a secret value; availability is derived server-side; audit records only a `secretRefPresent` boolean.
- **Prompt-injection defence.** Ingested/customer text is untrusted data: scanned at ingestion (safe categories only, malicious text never logged; an injection flag blocks approval) and wrapped in a fixed delimiter block at answer time, kept separate from system instructions.
- **SSRF prevention.** Ingest-by-URL is validated by `validateExternalUrl` (scheme allow-list; rejects loopback/private/link-local/CGNAT/multicast IPs, IPv4-mapped IPv6, embedded credentials, and cloud-metadata hosts). The production fetch worker must also re-validate the resolved IP after DNS and on redirects.
- **Read-only tool allow-list.** Dynamic project facts come only from a fixed set of parameterised, read-only tools — no arbitrary SQL or table access, no mutations, no internal ids/URLs exposed.
- **Audit + isolation.** AI/knowledge audit actions carry ids + safe summaries only (never prompt bodies, raw lead text, full content, or credentials); every Phase 5A table is tenant-scoped under RLS, with project scoping additionally enforced in retrieval/tools/orchestrator.

## Phase 5B.0 additions (record-only responder)

Phase 5B.0 hardens the automatic responder while keeping it **record-only** — a customer-visible automatic send is impossible by construction (compile-time `LIVE_SEND_MASTER_SWITCH = false`, the `send_candidate_status` enum has no `delivered`/`sent` value, and the `ai_responder_decisions` CHECK forbids `deliver`). See [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md) and [`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md).

The following security scenarios must all **fail safe** (no send, no escalation of privilege, no cross-scope leak). They are listed so that, when the live-send worker is wired in a reviewed 5B.1 PR, each has a corresponding test before any real delivery is enabled:

- **Forged runtime enablement** — a client-supplied or forged enablement flag grants no send (the master switch dominates and is server/compile-side).
- **Unauthorized enablement** — enabling a channel without `responder.channel.manage` is rejected.
- **Single-approver activation** — an activation with only one approval cannot proceed; two-person approval is required.
- **Expired approval** — a stale/expired activation approval does not authorise sending.
- **Cross-tenant flag use** — a tenant cannot use another tenant's channel settings/activation.
- **Cross-channel flag use** — enablement for one channel does not enable another.
- **Global / tenant / channel / project switch false** — any level being off blocks the send (broadest wins).
- **Kill switch activated after queueing** — a candidate queued before a kill-switch activation is revalidated and suppressed, not delivered.
- **DNC / consent / human-reply / human-takeover / close after generation** — any of these occurring between candidate creation and worker time cancels the candidate.
- **Candidate expired** — a candidate past `expires_at` (default `now() + 15 min`) is not sent.
- **Knowledge superseded after generation** — withdrawn/superseded knowledge cancels the candidate.
- **Inventory stale after generation** — stale inventory cancels the candidate.
- **Duplicate worker** — two workers claiming the same inbound produce at most one candidate (unique idempotency key).
- **Uncertain provider result** — an uncertain/timeout attempt is never blindly resent; it routes to manual review.
- **Provider callback replay** — a replayed delivery callback for an already-finalized candidate is a no-op.

**Already covered by the embedded harness today:** cross-tenant RLS on the five new tables, idempotency uniqueness, requester-cannot-self-approve (the `responder_approval_requester_guard` trigger), no `delivered`/`sent` status (the enum has none), no `live` runtime mode, and a simulated candidate creating no customer message. **Remaining to add when the worker is wired:** the worker-time scenarios — kill-switch-after-queueing, DNC/consent/human-reply/takeover/close-after-generation, candidate expiry, knowledge superseded, inventory stale, duplicate worker, uncertain provider result, and provider callback replay (these require the real worker to exist; see [`TECH_DEBT.md`](./TECH_DEBT.md)).

## Phase 6A additions (deterministic lead scoring)

Phase 6A scoring is **advisory / record-only** and fairness-constrained. Its safety model rests on four properties; see [`SCORING_FAIRNESS.md`](./SCORING_FAIRNESS.md) and [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md).

- **Advisory-only boundary.** Scoring records an opinion and never changes a lead's stage, assignment, status, or conversation operating mode, and never enqueues, drafts, or sends any customer-facing message, and never alters inventory/project facts. Automatic pipeline/stage/assignment/status changes from a score are a later, explicitly-approved automation phase. The Phase 5B.1 external stop-line is preserved — automatic customer sending remains impossible. A harness assertion proves a score run leaves the lead's stage/status unchanged.
- **Fairness — two enforcement layers.** A prohibited-signal catalogue (`PROHIBITED_SIGNAL_KEYS`: race, ethnicity, religion, caste, political_affiliation, sexual_orientation, disability, medical_status, gender, family_status, socioeconomic_profile, accent, name_demographic, neighbourhood_demographic) is enforced **(1)** in the domain layer — `assertNoProhibitedSignals` at model-config time and drop-on-calculate inside `calculateLeadScore` (a prohibited observation is dropped even if injected) — and **(2)** in the database — an `is_prohibited_signal(text)` function plus CHECK constraints on `scoring_rules`, `scoring_signal_definitions`, and `lead_signal_observations` reject prohibited keys even on a direct SQL write. No protected trait is inferred from names, language, photos, addresses, or style; source or language alone cannot disqualify; missing data is never automatically negative.
- **RLS + tenant isolation.** All 14 scoring tables enable RLS keyed on `tenant_id`, with reads/writes gated on the 8 new scoring permission keys. Cross-tenant isolation is asserted in the harness. Tenant-supplied `tenant_id` is never trusted.
- **Versioned, immutable, explainable.** An active model version is immutable (rule edits are blocked by a trigger; you draft a new version), exactly one version is active per model, every score run stamps the exact version (`NOT NULL`), and history is append-only — so a score is reproducible and there are no unexplained changes (see [`SCORING_EXPLAINABILITY.md`](./SCORING_EXPLAINABILITY.md)). 17 scoring audit actions record model, run, override, and signal-definition mutations.

## Phase 6B additions (deterministic project matching)

Phase 6B matching is **advisory / record-only**, fairness-constrained, and inventory-safe. It builds on the scoring core and its safety model rests on five properties; see [`MATCHING_FAIRNESS.md`](./MATCHING_FAIRNESS.md), [`MATCHING_INVENTORY_SAFETY.md`](./MATCHING_INVENTORY_SAFETY.md), and [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md).

- **Advisory-only boundary.** Matching records a fit opinion and **never assigns a lead, changes a lead's stage, status, or score, reserves/holds/books inventory or alters inventory/project facts, changes a conversation's operating mode, or enqueues, drafts, or sends any customer-facing message**. Automatic lead assignment / stage / status / score changes from a match are a later, explicitly-approved automation phase. The Phase 5B.1 external stop-line is preserved — automatic customer sending remains impossible, and scoring and matching are advisory-only. A harness assertion proves a match run leaves the lead's stage/status unchanged.
- **Fairness — two enforcement layers.** The same prohibited-input catalogue (`PROHIBITED_SIGNAL_KEYS`) is enforced **(1)** in the domain layer — `assertNoProhibitedMatchInputs` and drop-on-calculate inside `calculateProjectMatches` (a prohibited input is dropped even if injected) — and **(2)** in the database — a CHECK on `matching_rules` rejects a prohibited key on **both** `signal_key` and `candidate_field` even on a direct SQL write. No protected trait is inferred: there is no name/language/source-based exclusion, no neighbourhood demographic profiling (location uses structured locality data only), accessibility is matched as an expressed requirement rather than inferred health, and travel times are never fabricated (Unknown unless a trusted stored distance fact exists).
- **Inventory safety.** A unit is presented as confirmed only when `verified_available` (in-tenant, active+approved project, configuration match, status available, within the freshness window, no reservation conflict, user-permitted). Stale/unknown/unavailable inventory is never shown as confirmed — a project-level recommendation may stand while a re-verification request is surfaced. No discounts, taxes, or charges are ever invented; budget outcomes use approved structured data only.
- **RLS + tenant isolation.** All 14 matching tables enable RLS keyed on `tenant_id`, with reads/writes gated on the 8 new matching permission keys. Parameterized cross-tenant SELECT isolation across all 14 tables and cross-tenant INSERT denial are asserted in the harness. Tenant-supplied `tenant_id` is never trusted.
- **Versioned, immutable, explainable.** An active matching model version is immutable (rule edits blocked by a trigger; you draft a new version), exactly one version is active per model, every match run stamps the exact version (`NOT NULL`) with its preference/qualification snapshots and `inventory_snapshot_at`, and runs are append-only — so matches are reproducible and every recommendation/exclusion is explainable (see [`MATCHING_EXPLAINABILITY.md`](./MATCHING_EXPLAINABILITY.md)). 16 matching audit actions record model, run, override, and feedback mutations.

## Phase 7A additions (external integration foundation)

Phase 7A performs **no external IO** — it sends nothing, connects to no live
provider, opens no socket, downloads no media, and verifies no real webhook
domain. Everything is **mock / simulation / record-only**. The frozen safety
switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
outbox, automatic customer sending impossible). See
[`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md),
[`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md), and
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md).

- **Secret-ref only.** Provider secrets are **never** stored in the database.
  `integration_credentials_metadata` holds a `secret_ref` (pointing at a
  server-side encrypted store) plus safe metadata — there is **no plaintext
  secret/token/password column** (a harness assertion proves this). The
  service-role key and any provider secret never reach the browser; HMAC over a
  webhook body is computed server-side and only the constant-time comparison runs
  in the domain.
- **Webhook security.** `decideWebhookAcceptance` rejects on method, content-type,
  size, missing/invalid signature (constant-time compare), expired timestamp
  (replay window), and unknown/disabled integration. The tenant and integration
  are resolved from the **configured endpoint, never the payload**. Acceptance and
  rejection are audited (`integration.webhook.verified` /
  `integration.webhook.rejected`).
- **RLS + tenant isolation.** All **33** integration tables enable RLS keyed on
  `tenant_id`; reads/writes are gated on the 16 integration permission keys
  (config writes need `integrations.manage`; event tables are read-only to clients
  via `integrations.events.read` with writes server-role only; human outbound
  insert needs `channels.human_send.simulate`). Parameterized cross-tenant SELECT
  isolation across all integration tables and cross-tenant INSERT denial are
  asserted; the marketing role cannot read `external_events`.
- **No external IO; sends nothing.** A DB `CHECK (status <> 'connected')` makes a
  live connection impossible; `computeHealthState` is never `healthy` on
  configuration alone; human outbound is **simulation-only**
  (`CHECK (simulated = true)`, no provider reference, no delivered/sent state);
  the AI send boundary is untouched (`send_candidate_status` still has no
  `delivered`/`sent`). Binary media is a **provider reference only**
  (`external_reference_only`, `not_scanned`) — no download, no Storage.
- **Untrusted external content.** Webhook payloads, email bodies, and document/
  website text are treated as untrusted (prompt-injection / phishing): reference
  only, never instructions. The domain provides `stripQuotedHistory`,
  `isDangerousUrl`, and `redactSecrets` for safe handling and log/redaction
  ([`AI_SECURITY.md`](./AI_SECURITY.md)).
