# Integrations Strategy

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §8, §18–21, §29–30. All integrations follow a common connector architecture: verify authenticity → store raw event → idempotency → normalize → process via durable jobs. Secrets stay server-side. Implemented in `packages/integrations` + `supabase/functions`.

---

## 1. Connector architecture (shared contract)

Every inbound source flows through the same stages (§8):

1. **Verify authenticity** (signature/HMAC/shared secret/OAuth) where available.
2. **Store original event** (`webhook_events`, `raw_payload jsonb`).
3. **Idempotency key** — generated or read; deduped via `idempotency_keys`.
4. **Normalize** to canonical lead/message shape (phones → E.164).
5. **Validate** contact fields.
6. **Dedupe** (multi-signal, [`SCORING_ENGINE`]-adjacent logic in `packages/domain`).
7. **Create or merge** lead; preserve **all** attribution touchpoints.
8. **Trigger** qualification, scoring, assignment, first response.
9. **Audit** entry.

Endpoints accept fast and **enqueue**; workers do the heavy, retryable work. Retries use exponential backoff with max attempts and a dead-letter table (`dead_letter_events`) with manual replay. Every job log carries `correlation_id`, `tenant_id`, `source_event_id` (§29).

## 2. Lead sources & connectors

| Source                                         | Mechanism                                                               | Notes                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Google PPC / Google lead forms                 | Webhook / API ingestion                                                 | UTM + campaign captured                                   |
| Meta PPC / Meta lead forms                     | Signed webhook                                                          | Verify Meta signature                                     |
| Personal campaign landing pages                | Website lead-form endpoint                                              | UTM, page URL, campaign                                   |
| Website forms                                  | `/forms/:tenant` endpoint                                               | CSRF/rate-limited                                         |
| Website chatbot                                | Chat widget → conversation                                              | UTM/page/project preselect                                |
| WhatsApp                                       | Meta Cloud webhook                                                      | See §4                                                    |
| NoBroker / 99acres / Housing.com / Magicbricks | API where available; otherwise Gmail parsing, CSV/XLSX, generic webhook | Many portals lack usable APIs — fallbacks are first-class |
| Broker submissions                             | Form / manual / API                                                     | Triggers broker-overlap detection                         |
| Email lead notifications                       | Gmail parsing                                                           | §5                                                        |
| Manual entry                                   | App UI                                                                  | Permission-gated                                          |
| CSV / XLSX upload                              | Import wizard                                                           | Column-mapping templates                                  |
| Generic API / webhook                          | `/api/v1/leads`, `/webhooks/generic`                                    | Tenant-scoped, idempotent                                 |

**Import mapping wizard:** maps arbitrary spreadsheet columns to product fields, saves reusable templates per source, validates rows, and reports per-row errors (`import_jobs`, `import_errors`, `inventory_imports` for inventory).

## 3. Duplicate & broker-overlap handling

Multi-signal dedupe (normalized phone, phone without prefix, email, alternate phone, source lead ID, fuzzy name + second identifier, same campaign + contact within a window) with confidence levels (exact/probable/possible/none). Exact may auto-merge per tenant settings; others go to a review queue. Merges are reversible and preserve everything (§9). **Broker/direct overlap** is flagged as a potential attribution/commission conflict and resolved by an admin (status, notes, source precedence, datetime, responsible user, estimated commission exposure) — never auto-decided.

## 4. WhatsApp (Meta Cloud API default)

### 4.1 Provider interface

```ts
interface MessagingProvider {
  sendText(...); sendTemplate(...); sendMedia(...); markRead(...);
  processWebhook(...); normalizeInboundMessage(...); getDeliveryStatus(...);
}
```

Adapters: **Meta Cloud API** (default), **Gupshup**, **Twilio**.

### 4.2 Capabilities

Inbound text/images/documents/audio-metadata/interactive replies/buttons/lists/templates; delivery/read/failure events; contact info; media downloads; template language/category/approval status.

### 4.3 Tenant onboarding

Business account details, phone-number ID, WhatsApp Business Account ID, webhook verification, access-token validation, template synchronization, test message, integration health. **Access tokens never reach the browser.** Respect messaging-session restrictions, template requirements, consent and opt-out.

## 5. Gmail (OAuth, minimum scopes)

Reads lead-notification emails from portals, parses new lead info, sends rep alerts where configured, links source email to the lead, avoids duplicate processing (idempotency). Source-specific parsers + a generic configurable parser. **Validate sender domains and message patterns**, not just sender names. Tokens stored server-side encrypted.

## 6. Google Calendar (OAuth)

Agent calendar connection, availability checking, site-visit booking, rescheduling, cancellation, reminders, with project location, assigned agent, lead contact, internal notes, and status synchronization. **Prevent double-booking.** Store event linkage without exposing provider tokens.

## 7. Website chat widget

Small JS embed identifying the tenant; captures project preselection, UTM, page URL, campaign; responsive/branded; language detection; file/brochure sharing; conversation persistence; WhatsApp handoff; human takeover; rate limiting; bot-abuse protection. Tenant config: welcome message, avatar, colours, position, working hours, enabled pages, initial questions, project context (§20).

## 8. Ad lead ingestion (Google Ads / Meta)

Lead-form webhooks and API pulls bring in campaign/UTM/cost context for attribution and ROI metrics (cost per lead / qualified lead / site visit / booking where spend data exists). Stored as `lead_source_events` + `attribution_touchpoints`.

## 9. Public/integration API (§30)

Documented APIs for lead create/update/search, webhook ingestion, conversation messages, project data, inventory, site visits, tasks, scoring, documents, reporting. Cross-cutting: authentication, tenant scoping, validation (Zod), pagination, rate limits, idempotency, consistent error format, versioning (`/api/v1`), request IDs. OpenAPI generated where practical. Full surface in [`API_MAP.md`](./API_MAP.md).

## 10. Reliability & health

All integration work is durable (queues + workers), idempotent, retried with backoff, and dead-lettered with manual replay. `integration_sync_runs` records each sync; `webhook_delivery_attempts` records each attempt. The **Integrations → Health** page and admin **system-health** page surface status, last sync, failures, and queue depth (§32).

## 11. Secrets

Provider secrets live in a server-side encrypted store; only non-secret metadata in `integration_credentials_metadata`. Webhook secrets verify inbound authenticity. No integration secret is ever shipped to or readable by browser code ([`SECURITY.md`](./SECURITY.md)).

## 12. Phase-0 note on credentials

Building the connector _code_ needs no live credentials (tested against fixtures/synthetic payloads). Going live requires tenant-supplied credentials (Meta WABA, Gmail/Calendar OAuth, AI keys, portal access) — these are **build stop-conditions** for later phases, tracked in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

---

## Phase 7A — external integration foundation (2026-06-20)

Phase 7A builds the **shape** of every integration above with **no external IO**:
it sends nothing, connects to no live provider, opens no socket, downloads no
media, and verifies no real webhook domain. Everything is **implemented locally /
simulated / mock-only** against synthetic fixtures. The frozen safety switches are
preserved unchanged: `LIVE_SEND_MASTER_SWITCH=false`,
`RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
outbox, and automatic customer sending impossible.

- **Domain core** (`packages/domain/src/integrations.ts`, pure, 19 tests) — a
  provider-neutral `ExternalIntegrationAdapter`; the `NormalizedExternalEvent`
  envelope; idempotency (`decideIdempotency`: new / duplicate_ignore /
  conflict_reject); the deterministic webhook gate (`decideWebhookAcceptance` +
  `constantTimeEqual` + `withinReplayWindow`, with tenant/integration resolved
  from the endpoint, never the payload); WhatsApp inbound normalization (media =
  provider reference only, `external_reference_only` / `not_scanned`; unsupported
  → safe), WhatsApp policy (`evaluateWhatsAppPolicy`), forward-only delivery
  callbacks; email helpers (`stripQuotedHistory` / `isDangerousUrl` /
  `redactSecrets`) and the deterministic `parsePortalEmail` (never invents fields,
  routes to review on missing contact); health (`computeHealthState`, never
  healthy on config alone), `classifyFailure`, `decideReplay`; and mock / failure
  / malformed / duplicate / out-of-order adapters.
- **Schema** (`supabase/migrations/0024_integration_foundation.sql`) — **33**
  tenant-scoped RLS tables (connections + versions + credentials-metadata
  [secret_ref + safe metadata only, no plaintext secret column] + health/sync/
  rate-limit; external events + attempts/failures/dead-letters/replays/identity;
  channels + webhook endpoints; WhatsApp accounts/numbers/templates/versions/
  windows/provider-events; email mailboxes/sync/parsing; source adapters/mappings;
  human outbound requests/attempts/**simulations** [`CHECK simulated=true`]),
  **16** permissions, **24** audit actions, a per-tenant synthetic `manual_test`
  seed, and a DB `CHECK (status <> 'connected')` forbidding any live connection.
- **Server / UI** — a record-only surface (`/settings/integrations*`,
  `/integrations/events`) and webhook route shape, described honestly as **mock /
  simulation / record-only**; the exact file inventory is reconciled by the
  parent.

Live provider activation, real credentials, accounts, webhook-domain
verification, provider app review, Pub/Sub, IMAP/SMTP, paid services, compliance
approval, live Supabase, production queues/monitoring, Storage, and any live send
are all **Phase 7B**. See [`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md),
[`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md),
[`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md),
[`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md),
[`WHATSAPP_POLICY.md`](./WHATSAPP_POLICY.md),
[`EMAIL_INTEGRATION.md`](./EMAIL_INTEGRATION.md),
[`PORTAL_ADAPTERS.md`](./PORTAL_ADAPTERS.md),
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md), and
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md).
