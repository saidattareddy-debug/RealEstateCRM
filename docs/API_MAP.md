# API Map

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §30 (+ §8, §19–21). All APIs are tenant-scoped, authenticated, validated (Zod), paginated, rate-limited, idempotent where they mutate, versioned (`/api/v1`), and return a consistent error envelope with request IDs. OpenAPI generated where practical.

---

## 1. Cross-cutting conventions

- **Auth:** session cookie (first-party app) or API key / bearer (integration API). Every request resolves a tenant + permission set; unauthorized → `401`/`403`.
- **Tenant scoping:** server derives `tenant_id` from auth context; never from request body.
- **Validation:** Zod schemas in `packages/validation`; invalid → `422` with field errors.
- **Pagination:** cursor-based (`?cursor=&limit=`); responses include `next_cursor`.
- **Idempotency:** mutating endpoints accept `Idempotency-Key`; deduped via `idempotency_keys`.
- **Rate limits:** per tenant + per key; `429` with retry headers.
- **Errors:** `{ "error": { "code", "message", "details?", "request_id" } }`.
- **Versioning:** path-based `/api/v1`. **Request IDs:** `X-Request-Id` echoed and logged.

## 2. Endpoint surface (v1)

### Leads

| Method | Path                       | Purpose                           | Key permission            |
| ------ | -------------------------- | --------------------------------- | ------------------------- |
| POST   | `/api/v1/leads`            | Create lead (normalized, deduped) | `leads.create`            |
| GET    | `/api/v1/leads`            | Search/list (filters, cursor)     | `leads.read.*`            |
| GET    | `/api/v1/leads/:id`        | Lead detail                       | `leads.read.*`            |
| PATCH  | `/api/v1/leads/:id`        | Update fields/stage               | `leads.update`            |
| POST   | `/api/v1/leads/:id/assign` | Assign/reassign                   | `leads.assign`/`reassign` |
| POST   | `/api/v1/leads/:id/merge`  | Merge duplicate (reversible)      | `leads.merge`             |
| GET    | `/api/v1/leads/:id/score`  | Score + components + history      | `scoring.read`            |

### Conversations & messages

| POST | `/api/v1/conversations/:id/messages` | Send message (agent) | `conversations.reply` |
| GET | `/api/v1/conversations/:id` | Thread + summary + sources | `conversations.read.*` |
| POST | `/api/v1/conversations/:id/takeover` | Human takeover (pauses AI) | `conversations.takeover` |

### Projects & inventory

| GET/POST/PATCH | `/api/v1/projects[/:id]` | Project CRUD | `projects.*` |
| GET/POST/PATCH | `/api/v1/inventory/units[/:id]` | Unit CRUD + status/price | `inventory.*` |
| POST | `/api/v1/inventory/imports` | Bulk import (mapping) | `inventory.import` |

### Knowledge / documents

| POST | `/api/v1/documents` | Upload/ingest (→ processing) | `knowledge.manage` |
| POST | `/api/v1/documents/:id/approve` | Approve for buyer answers | `knowledge.approve` |
| POST | `/api/v1/knowledge/query` | RAG answer tester (internal) | `knowledge.manage` |

### Scoring

| GET/POST | `/api/v1/scoring/rule-sets` | Manage rule sets/versions | `scoring.edit` |
| POST | `/api/v1/scoring/simulate` | Historical simulation | `scoring.edit` |
| POST | `/api/v1/scoring/publish` | Publish/rollback | `scoring.publish` |

### Site visits & tasks

| GET/POST/PATCH | `/api/v1/site-visits[/:id]` | Lifecycle + calendar sync | `sitevisits.manage` |
| GET/POST/PATCH | `/api/v1/tasks[/:id]` | Task CRUD | `tasks.manage` |

### Reporting

| GET | `/api/v1/reports/:report` | Filtered analytics datasets/export | `analytics.*.read` |

## 3. Ingestion endpoints (webhooks & forms)

| Method   | Path                           | Source                        | Auth                          |
| -------- | ------------------------------ | ----------------------------- | ----------------------------- |
| GET/POST | `/webhooks/whatsapp/:tenant`   | Meta Cloud (verify + inbound) | Meta signature + verify token |
| POST     | `/webhooks/meta-leads/:tenant` | Meta lead forms               | Meta signature                |
| POST     | `/webhooks/google-ads/:tenant` | Google lead forms/Ads         | Shared secret/token           |
| POST     | `/webhooks/generic/:tenant`    | Generic source                | Per-integration HMAC/secret   |
| POST     | `/forms/:tenant/:formId`       | Website lead form             | Origin + token + rate limit   |
| POST     | `/chat/:tenant`                | Website chat widget           | Widget token + rate limit     |

All ingestion endpoints: verify authenticity → persist raw event → idempotency → fast `200` ack → enqueue durable processing ([`INTEGRATIONS.md`](./INTEGRATIONS.md) §1).

## 4. OAuth callbacks

- `/oauth/google/callback` — Gmail + Calendar (server-side token exchange; tokens stored encrypted, never returned to browser).
- `/oauth/meta/callback` — Meta onboarding where applicable.

## 5. Internal server actions (non-public)

First-party UI mutations primarily use **Next.js Server Actions** (not the public API) with the same permission + tenant checks and Zod validation. The public `/api/v1` surface exists for integrations and documented programmatic access.

## 6. Security notes

No service-role key or provider secret is reachable from any browser-exposed endpoint; webhooks are signature-verified; mutations are idempotent and audited; outbound messaging respects do-not-contact/consent/session rules. See [`SECURITY.md`](./SECURITY.md).

## Phase 3.1 ingestion endpoints (implemented)

| Method & path                   | Auth                                             | Behaviour                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/leads`            | `x-form-id` + hashed `x-api-key` (constant-time) | timestamp tolerance, per-key rate limit, 32 KB cap, `idempotency-key` header; persists `lead_ingestion_events` before processing; returns `{ok, version:'v1', requestId, data:{leadId, idempotent, status}}` (201 new / 200 idempotent); non-disclosing errors |
| `POST /webhooks/leads/[source]` | hashed api-key **or** HMAC signature             | adapter per `[source]` (generic, NoBroker, 99acres, Housing, Meta-lead, Google-lead); timestamp + rate limit + 64 KB cap; idempotency via `external_event_id`                                                                                                  |
| `POST /api/forms/[formId]`      | public, credential-light                         | origin allow-list, 16 KB cap, rate limit, timestamp replay window, honeypot (silent 202), consent capture, correlation id; **never reveals if a contact exists; no tenant id / DB-error leakage**                                                              |
| `GET /leads/export`             | session + `leads.export`                         | RLS-scoped CSV, 5000-row cap, audited, formula-injection-safe                                                                                                                                                                                                  |

All four persist/validate before side effects and return consistent, safe
envelopes. Production webhook registration and the PGMQ-backed worker are deferred
(see [`PHASE_3_1_AUDIT.md`](./PHASE_3_1_AUDIT.md) §4).

## Phase 4 website-chat endpoints (implemented)

| Method & path                       | Auth                                   | Behaviour                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat/[widgetId]/start`   | public; `widgetId` = widget public key | origin allow-list, 8 KB cap, rate limit, timestamp window, honeypot, consent; idempotent ingest + opens a `website_chat` conversation keyed by an opaque session id; stores the first inbound message. Returns **only** the opaque session id |
| `POST /api/chat/[widgetId]/message` | public; session id in body             | appends an inbound message, idempotent on `external_message_id`; same hardening; non-disclosing ack                                                                                                                                           |

Both never reveal whether a contact exists and never expose tenant/lead/
conversation identifiers or DB errors. The service role is used server-side only;
no secret is shipped to the browser. The embed contract is a small script that
POSTs JSON to these two endpoints. See [`CONVERSATIONS.md`](./CONVERSATIONS.md).

## Phase 4.1 (in progress)

Inbox operations are Next.js Server Actions (`inbox/actions.ts`,
`inbox/ops-actions.ts`): reply (DNC-checked), takeover, end-takeover (→ paused,
never AI), transfer, status/priority change (+history), internal note, tag toggle,
mark-read (own-row only), message redaction, DNC entry. Planned HTTP surfaces —
`/widget.js`, `/chat/widget/[widgetId]`, the install page, `/chat/demo`, the
polling-transport `fetchSince`/`markRead` endpoints, and inbox search — are
tracked in [`TECH_DEBT.md`](./TECH_DEBT.md). The signed website-session model and
endpoints are in [`WEBSITE_CHAT.md`](./WEBSITE_CHAT.md).

## Phase 4.1 final wiring (2026-06-19)

Server actions (inbox): `transport-actions.fetchSinceAction`, `transport-send.sendReplyFromTransport`, `sla.recomputeSla`/`recomputeSlaAdmin`, `assign-actions.{assignConversationAction,assignTeamAction,setOwnerLockAction,resolveOwnerMismatchAction,listAgentEligibilityAction}`, `canned-actions.{listCannedRepliesForComposer,sendCannedReply,createCannedReply,updateCannedReply,setCannedReplyActive}`, `tag-actions.{createTag,renameTag,setTagColor,setTagActive,bulkTagConversations,listTags}`, `saved-view-actions.{listInboxViews,createInboxView,deleteInboxView,setDefaultInboxView}`. Public route updated: `POST /api/chat/[widgetId]/messages` (token-scoped polling + explicit `ackMessageId` read + unread count). `GET /widget.js` now emits an unread launcher badge via same-origin postMessage.

## Phase 5A (2026-06-20)

Phase 5A adds AI/knowledge **server actions** and a server-only `lib/ai` module layer. No new public/automatic send surface is added; the only outbound path remains the human `sendReplyAction`.

**Knowledge actions** (`app/(app)/knowledge/actions.ts`): `createKnowledgeSource` (`knowledge.create`, runs the ingestion pipeline; `document_url` requires pre-extracted text), `draftNewVersion` (`knowledge.edit`), `approveSource` (`knowledge.approve`, via pure `canApprove` — approver + reason + extraction + no injection flag), `rejectSource` (`knowledge.review`), `supersedeSource`/`rollbackToVersion` (`knowledge.approve`), `archiveSource` (`knowledge.archive`), `resolveKnowledgeConflict` (`knowledge.conflicts.resolve`), and read-only `testRetrieval` (`knowledge.read`).

**AI actions** (`app/(app)/ai/actions.ts`): `runTestLab` (`ai.test_lab.use`, synthetic input), `generateCopilotDraft` (`ai.copilot.use`), `dispositionDraft` (accept/edit/discard), `sendEditedDraft` (delegates entirely to `sendReplyAction` — no AI send path), `generateAiSummaryPreview` (`ai.copilot.use`, deterministic preview, never saved). None send or mutate conversation state.

**AI settings actions** (`app/(app)/settings/ai/actions.ts`): `upsertProviderConfig`/`setProviderActive` (`ai.providers.manage`; stores env-var name only, never a secret), `upsertModelConfig`/`upsertEmbeddingModelConfig`, `upsertFeaturePolicy`/`updateUsageLimits` (`ai.settings.manage`), `createPrompt`/`createPromptVersion`/`activatePromptVersion` (`ai.prompts.manage`; new versions land inactive, audit records reference + version only, never the prompt body).

**Server `lib/ai` modules:** `providers.ts` (env-gated factory, mock by default), `url-safety.ts` (SSRF guard), `ingestion.ts` (durable idempotent pipeline), `retrieval.ts` (approved/scoped hybrid retrieval + grounding evidence), `tools.ts` (read-only tool allow-list), `orchestrator.ts` (`runAiAnswer`). See [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) and [`AI_SECURITY.md`](./AI_SECURITY.md).

## Phase 6A (2026-06-20)

Phase 6A adds deterministic-scoring **server actions** and a record-only scoring service. No new public/automatic surface and no outbound path are added; scoring is advisory only. Every action enforces a `(tenant, scoring.*)` permission check and Zod validation, and re-checks RLS.

**Scoring actions** (scoring settings + lead panel + test lab), gated on the 8 new permission keys:

- **Models / versions / rules** — list/read models and versions (`scoring.models.read`); create a model, draft a new version, edit rules on a draft, submit for approval, activate a version (`scoring.models.manage`); approve a pending version (`scoring.models.approve`). Active versions are immutable (a draft-new-version flow is enforced).
- **Signal definitions** — manage signal definitions (`scoring.signals.manage`); prohibited keys are rejected by the DB CHECK and the domain guard.
- **Score runs** — record a signal observation and recalculate a lead's score (`scoring.run`); the service calls the pure `calculateLeadScore`, writes a version-stamped `lead_score_runs` row + components + history delta, and **never** changes the lead's stage/assignment/status or any outbound path. Recalculation is invoked through the durable-job abstraction (`apps/web/src/lib/jobs/`, local-sync today).
- **Overrides** — apply or clear a manual score/classification override with a reason and optional expiry (`scoring.override`); `effectiveScore` overlays it on the calculated values, which are preserved.
- **Evaluation** — run the scoring model against an evaluation dataset/cases (`scoring.evaluation.use`); read-only against synthetic data.

The score read surface (`GET /api/v1/leads/:id/score`, `scoring.read`) returns the calculated score + classification + components + history + effective score. See [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md) and [`SCORING_EXPLAINABILITY.md`](./SCORING_EXPLAINABILITY.md).

## Phase 6B (2026-06-20)

Phase 6B adds deterministic-matching **server actions** and a record-only matching service. No new public/automatic surface and no outbound path are added; matching is advisory only and **never assigns a lead, changes a lead's stage/status/score, reserves inventory, or sends anything**. Every action enforces a `(tenant, matching.*)` permission check and Zod validation, and re-checks RLS.

**Matching actions** (matching settings + lead panel + project-side view + test lab), gated on the 8 new permission keys:

- **Models / versions / rules** — list/read models and versions (`matching.models.read`); create a model, draft a new version, edit draft rules, submit for approval, activate a version (`matching.models.manage`); approve a pending version (`matching.models.approve`). Active versions are immutable (a draft-new-version flow is enforced); prohibited keys on either `signal_key` or `candidate_field` are rejected by the DB CHECK and the domain guard.
- **Match runs** — `runLeadMatch` generates candidates from real projects/configs/inventory under RLS and recalculates a lead's matches (`matching.run`); the service calls the pure `calculateProjectMatches` and writes a version-stamped `lead_match_runs` row + candidates + components + inventory snapshots, and **never** changes the lead's stage/assignment/status/score, reserves inventory, or touches any outbound path. Recalculation is invoked through the durable-job abstraction (`apps/web/src/lib/jobs/`, local-sync today).
- **Overrides** — apply or clear an effective-rank override with a reason (`matching.override`); the calculated ranking is preserved beneath it.
- **Feedback** — record advisory feedback on a candidate (`matching.feedback.create`); feedback never alters the calculated run.
- **AI preference extraction** — a review-only step proposes structured lead preferences for human review; the AI never determines the ranking.
- **Evaluation** — run the matching model against an evaluation dataset/cases (`matching.evaluation.use`); read-only against synthetic data.

The match read surface returns, per candidate, the classification, score, inventory state, budget outcome, match confidence, preference completeness, eligibility outcome, per-rule components, and effective vs calculated rank (`matching.read`). The `/matching/test-lab` action runs in TEST MODE — no lead, project, or inventory is updated. The Phase 5B.1 external stop-line is preserved — automatic customer sending remains impossible. See [`MATCHING_ARCHITECTURE.md`](./MATCHING_ARCHITECTURE.md) and [`MATCHING_EXPLAINABILITY.md`](./MATCHING_EXPLAINABILITY.md).

## Phase 7A — external integration foundation

Phase 7A adds the integration surface. Every route/action below performs **no
external IO** — nothing connects to a live provider or sends a customer-facing
message; everything is **mock / simulation / record-only** against synthetic
fixtures. The frozen safety switches are preserved
(`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`, advisory-only
scoring + matching, record-only AI outbox, automatic customer sending impossible).
The exact server file inventory is reconciled by the parent agent.

- **Webhook ingestion route** — a public webhook endpoint (under
  `/webhooks/...`, resolved per `channel_webhook_endpoints.public_path`) whose
  acceptance is decided by `decideWebhookAcceptance`: it checks method,
  content-type, body size, signature (constant-time compare of a server-computed
  HMAC), replay window, and that the integration is known + enabled. **The tenant
  and integration are resolved from the endpoint, never the payload.** Accepted
  requests are normalized and **persisted before processing** into
  `external_events` (unique on `(tenant_id, idempotency_key)`). In 7A the route
  receives only synthetic traffic; no live provider posts to it.
- **Connection / channel management actions** — create/update/disable connections,
  configure channels, manage WhatsApp accounts/numbers/templates and email
  mailboxes/parsing rules, and manage source mappings — gated on
  `integrations.manage` / `integrations.mappings.manage` and the channel keys.
  Verification is **simulated** (a connection can never become `connected`).
- **Event operations** — read the external-event log (`integrations.events.read`)
  and request a replay (`integrations.events.replay`, governed by the
  permissioned, idempotent `decideReplay`).
- **Human outbound (simulation only)** — prepare a rep-initiated message
  (`channels.human_send.simulate`); the result is always
  `{ simulated: true, providerMessageRef: null }`, recorded in
  `human_outbound_requests` / `_attempts` / `_simulations`
  (`CHECK simulated = true`). There is no automatic and no live send path.

See [`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md),
[`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md),
[`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md), and
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md).
