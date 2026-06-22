# Integration Architecture (Phase 7A — Foundation)

This document describes the **Phase 7A external integration foundation**: a
provider-neutral, deterministic, tenant-isolated foundation for ingesting and
normalizing external events and for preparing human-initiated outbound messages.

> **Phase 7A performs NO external IO.** It opens no socket to any provider, sends
> nothing to any customer, connects to no live account, downloads no media, and
> verifies no real webhook domain. Everything here is **implemented locally**,
> exercised with **synthetic fixtures**, and stored as **mock / simulation /
> record-only** data. The frozen safety switches are preserved unchanged:
> `LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`, scoring and
> matching are advisory-only, the AI outbox is record-only, and automatic
> customer sending is impossible by construction. All live provider activation is
> **Phase 7B**.

---

## 1. Purpose and scope

Phase 7A builds the **shape** of every external integration without any external
behaviour:

- a provider-neutral adapter contract every channel implements,
- a single normalized event envelope all inbound events collapse to,
- a webhook-acceptance gate that decides accept/reject deterministically,
- persist-before-process event storage with idempotency, attempts, failures,
  dead-letters, and replay,
- WhatsApp, email, and lead-portal normalization logic,
- a **human-initiated** outbound path that is **simulation-only** in 7A,
- per-connection health, sync cursors, and rate-limit state.

What it deliberately does **not** do (all **Phase 7B**): real provider IO, real
credentials, real accounts, real webhook-domain verification, provider app
review, Pub/Sub, IMAP/SMTP, paid services, compliance/privacy approval, live
Supabase, production queues, production monitoring, Storage for binary media, and
any live WhatsApp or email send.

## 2. Layering and dependency direction

The foundation respects the repository's leaf-first dependency rule
([`ARCHITECTURE.md`](./ARCHITECTURE.md)).

- **`packages/domain/src/integrations.ts`** — the pure, framework- and
  DB-independent core (**implemented locally**, exhaustively unit-tested). It
  contains the adapter interface, the normalized event envelope, idempotency and
  webhook-acceptance decisions, WhatsApp / email / portal normalization, health
  classification, failure classification, and replay decisions, plus deterministic
  **mock / failure / malformed / duplicate / out-of-order** adapters. It does no
  IO of any kind; HMAC signing is done by the caller and only the _comparison_ is
  in the domain.
- **`supabase/migrations/0024_integration_foundation.sql`** — the 33 tenant-scoped
  RLS tables, 16 permissions, 24 audit actions, and a per-tenant synthetic
  `manual_test` seed connection (**implemented locally** against the embedded
  harness; **live-Supabase-blocked** for production verification — Phase 7B).
- **Server adapters / webhook routes / services / UI** — a thin record-only
  surface that persists normalized events and simulates human outbound. These are
  described honestly as **mock / simulation / record-only**; the exact server file
  inventory is reconciled by the parent agent. No server code in 7A reaches a live
  provider.

Nothing depends on `apps/web`; `domain` remains a leaf.

## 3. The provider-neutral adapter contract

Every channel — WhatsApp Cloud, Gmail, IMAP email, Meta / Google lead forms,
lead portals (NoBroker, 99acres, Housing, MagicBricks), and the generic
webhook / API / portal / `manual_test` providers — is expressed through one
interface, `ExternalIntegrationAdapter`:

- `provider` and a declared `capabilities` list (lead ingestion, inbound
  messages, outbound human messages, delivery / read callbacks, attachments,
  templates, mailbox sync, campaign attribution),
- `verifyConnection(context)` — returns a verification result. In 7A this is
  **simulated**; it can never return a `connected` status (see §6).
- `verifyWebhook(request, context)` — wraps the deterministic acceptance gate.
- `parseWebhook(request, context)` — turns a raw request into zero or more
  `NormalizedExternalEvent`s.
- `pullEvents(...)` and a **simulation-only** `sendHumanMessage(...)` whose result
  is always `{ simulated: true, providerMessageRef: null }`.

In 7A the only adapters that run are the deterministic **mock**, **failure**,
**malformed**, **duplicate**, and **out-of-order** adapters used to prove the
foundation behaves correctly under each condition. Real provider adapters are
**Phase 7B** and **credential-blocked**.

## 4. Inbound flow (persist-before-process)

The canonical inbound path, mirrored in the schema, is:

1. A request arrives at a **configured webhook endpoint**. The tenant and
   integration are resolved **from the endpoint, never from the payload**.
2. The deterministic acceptance gate decides accept or reject (§ see
   [`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md)).
3. Accepted requests are **normalized** into `NormalizedExternalEvent`s and
   **persisted first** into `external_events` (unique on
   `(tenant_id, idempotency_key)`), with attempts / failures / dead-letters /
   replays recorded in their own tables.
4. Idempotency is decided by `decideIdempotency`: same key + same payload hash →
   `duplicate_ignore`; same key + different hash → `conflict_reject`; otherwise
   `new`.
5. Processing is **record-only** in 7A — the event is stored and classified; no
   outbound is produced and no customer is contacted.

All of step 1's network behaviour is **simulated** in 7A; only the deterministic
decisioning and storage are exercised.

## 5. Outbound flow (human-initiated, simulation-only)

Phase 7A models a **human-initiated** outbound request (a rep choosing to send a
WhatsApp / email message). It is **simulation-only**:

- a request is recorded in `human_outbound_requests` (unique idempotency key),
- attempts are recorded in `human_outbound_attempts`,
- the outcome is recorded in `human_outbound_simulations` with a DB
  `CHECK (simulated = true)` — there is no non-simulated state, no provider
  reference, and no delivered/sent state.

There is **no automatic** outbound path at all. The AI responder outbox remains
record-only and the live-send master switch remains false; automatic customer
sending is impossible by construction.

## 6. The hard Phase 7A safety boundary

- A DB `CHECK (status <> 'connected')` on `integration_connections` makes it
  **impossible** to mark any connection live in 7A. `PHASE_7A_ALLOWED_STATUSES`
  in the domain mirrors this (`draft`, `unconfigured`, `test`, `disabled`).
- `computeHealthState` is **never `healthy` on configuration alone** — health
  reflects observed success/failure, so an unexercised connection is never shown
  as healthy.
- Provider secrets are **never** stored: `integration_credentials_metadata` holds
  a `secret_ref` and safe metadata only, with no plaintext secret/token column.
- The frozen switches are untouched: `LIVE_SEND_MASTER_SWITCH=false`,
  `RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
  outbox.

## 7. Design choices folded from the spec

Some spec tables were folded into adjacent tables as deliberate, honest design
choices:

- WhatsApp template **components** live as `jsonb` on
  `whatsapp_template_versions` (with a `variable_schema` jsonb) rather than a
  separate component table.
- Channel phone numbers are modelled as `whatsapp_phone_numbers` under a
  `whatsapp_business_accounts` parent rather than a generic channel-number table.

These are noted in [`DATABASE.md`](./DATABASE.md) and do not change any safety
property.

## 8. Related documents

[`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md) ·
[`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md) ·
[`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md) ·
[`WHATSAPP_POLICY.md`](./WHATSAPP_POLICY.md) ·
[`EMAIL_INTEGRATION.md`](./EMAIL_INTEGRATION.md) ·
[`PORTAL_ADAPTERS.md`](./PORTAL_ADAPTERS.md) ·
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md) ·
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md) · [`INTEGRATIONS.md`](./INTEGRATIONS.md)
