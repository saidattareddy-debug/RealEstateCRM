# External Event Model (Phase 7A)

The normalized external-event model is the single shape every inbound event from
every provider collapses to, plus the persist-before-process lifecycle that
stores it idempotently.

> **Phase 7A status.** This model is **implemented locally** in
> `packages/domain/src/integrations.ts` and `supabase/migrations/0024_*.sql`, and
> exercised with **synthetic fixtures** through deterministic mock adapters. It
> performs **no external IO**: no event here originates from a live provider. The
> frozen safety switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
> `RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only
> AI outbox, automatic customer sending impossible). Live ingestion is **Phase
> 7B**.

---

## 1. The normalized envelope

`NormalizedExternalEvent` is the provider-neutral envelope. Every adapter must
produce this shape:

- `tenantId`, `provider`, `integrationConnectionId` — ownership and origin,
  always resolved from the configured connection, never the payload.
- `externalEventId` — the provider's event id (used in the idempotency key).
- `eventType` — one of the normalized types (`lead_created`, `lead_updated`,
  `inbound_message`, `message_accepted`, `message_sent`, `message_delivered`,
  `message_read`, `message_failed`, `attachment_received`, `template_updated`,
  `account_state_changed`, `consent_or_optout`, `mailbox_changed`,
  `unsupported_event`).
- `occurredAt` / `receivedAt` — provider timestamp vs our receipt time.
- `subject` — `{ leadRef?, conversationRef?, contactPhone?, contactEmail?,
externalContactId? }`.
- `payloadVersion`, `normalizedPayload`, `rawPayloadReference?`.
- `payloadHash`, `idempotencyKey`, `correlationId`.

Unsupported provider content is normalized to `unsupported_event` rather than
failing ingestion — see §5.

## 2. Idempotency

- `payloadHash(rawBody)` is a stable hash over the raw body.
- `buildExternalIdempotencyKey(parts)` derives the key deterministically from the
  provider, connection, and external event id.
- `decideIdempotency(existing, incoming)` returns:
  - `new` — no row with this key,
  - `duplicate_ignore` — **same key + same hash** (a true duplicate, ignored),
  - `conflict_reject` — **same key + different hash** (a payload conflict,
    rejected; the original is never silently overwritten).

The database enforces this at rest with `UNIQUE (tenant_id, idempotency_key)` on
`external_events`. A harness assertion proves the uniqueness constraint holds.

## 3. Persist-before-process lifecycle

Accepted events are persisted **before** any processing:

- `external_events` — the canonical normalized event (status enum: `received`,
  `processing`, `processed`, `failed`, `retry_scheduled`, `dead_letter`,
  `duplicate`, `rejected`).
- `external_event_attempts` — one row per processing attempt
  (`UNIQUE (event_id, attempt_no)`).
- `external_event_failures` — a classified failure per failed attempt.
- `external_event_dead_letters` — terminal dead-letter records.
- `external_event_replays` — a permissioned, reasoned replay request stamped with
  adapter / mapping version.
- `external_identity_links` — links an external identity (e.g. a normalized
  phone) to a lead / conversation, with an `ambiguous` flag when the link is not
  unique.

In 7A every row in these tables originates from **synthetic** events; none comes
from a live provider.

## 4. Failure classification and replay

- `classifyFailure(httpStatus, code)` returns `retryable`, `permanent`, or
  `dead_letter` — a deterministic mapping used to decide whether an attempt is
  retried, abandoned, or dead-lettered.
- `decideReplay(input)` is a deterministic gate over a replay request: it checks
  the caller's **permission**, requires a **reason**, requires the **event** to
  exist, and is **idempotent** (it never duplicates a successful reprocess).

Real retry/backoff execution runs on production queues in **Phase 7B**; in 7A the
classification and replay **decisions** are exercised, but the durable-queue
execution path is **deferred** (the existing local-sync job abstraction stands
in).

## 5. Safe degradation

The model is designed so a malformed, duplicate, or out-of-order event never
corrupts state:

- The **malformed adapter** proves a bad payload is rejected cleanly.
- The **duplicate adapter** proves a repeat is ignored via idempotency.
- The **out-of-order adapter** proves delivery-state callbacks regress safely —
  `shouldApplyDeliveryCallback` is **forward-only**: it ignores regressions and
  duplicates while still allowing terminal `failed` / `cancelled` transitions.
- Unsupported content (`unsupported_event`) still produces a safe, stored event.

## 6. What is not in this model in 7A

- No real provider event (no live IO).
- No binary media bytes — media is a **provider reference only** (see
  [`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md)); Storage is **Phase
  7B**.
- No production-queue execution (durable retry/DLQ replay execution is **Phase
  7B**; decisions only in 7A).

See [`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md) and
[`INTEGRATION_OPERATIONS.md`](./INTEGRATION_OPERATIONS.md).
