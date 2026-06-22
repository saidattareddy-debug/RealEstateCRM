# Message Lifecycle

Inbound ingestion, delivery transitions, idempotency, and redaction. Authoritative
code: migration `0012`, `packages/domain/src/inbox.ts`,
`apps/web/src/app/(app)/inbox/ops-actions.ts`.

## Delivery transitions

`message_delivery_events` records each lifecycle event for a message. Legal
transitions are enforced by `validateDeliveryTransition`:

```
received → pending | queued | failed | cancelled
pending  → queued | sent | failed | cancelled
queued   → sent | delivered? (no) | failed | cancelled
sent     → delivered | read | failed
delivered→ read | failed
read     → (terminal)
failed   → queued | pending           (retry)
cancelled→ (terminal)
```

Rules: no impossible jumps; website messages are **not** marked `delivered`/`read`
without a real acknowledgement; failure code + a safe failure summary are kept,
and provider payload references stay separate from normalized data. Provider
errors are never shown to customers.

**Status:** the transition validator and table exist and are unit-tested; the
producers that emit delivery events are not yet wired (see `TECH_DEBT.md`).

## Inbound ingestion reliability

`message_ingestion_events` (unique `(tenant, idempotency_key)` + partial unique
`(tenant, widget, external_message_id)`), `message_idempotency_keys`,
`message_processing_attempts`, and `message_dead_letter_events` mirror the Phase
3.1 lead-ingestion design. Inbound messages must be **persisted before**
downstream processing. Repeated/concurrent events cannot duplicate messages,
unread increments, conversation events, audit events, lead associations, or SLA
events — the DB unique constraints make the second insert a no-op.

The harness verifies: duplicate inbound, same `(tenant,widget,external)` with a
different key, same external id under a different tenant (allowed), and ops-only
visibility. Local processing is synchronous and **explicitly non-production**
(reuses the Phase 3.1 job abstraction).

**Status:** schema, idempotency, and RLS are done and tested; routing the
`/api/chat` inbound path through this pipeline is pending (see `TECH_DEBT.md`).

## Redaction

`message_redaction_events` records the message, reason, actor, a **hash** of the
original (never the original text), and the replacement display text. Redaction
(`messages.redact`) replaces the message body with `[redacted]` and sets
`redacted=true`. The original never enters the audit log. Redacted content must
not appear in search, summaries, exports, or rendered caches; deterministic
summaries already read the replaced body. Search exclusion lands with Search.

## Phase 4.1 SLA events (2026-06-19)

`conversation_sla_events` now carries the full lifecycle (`started`, `first_response_due`, `due_recalculated`, `due_soon`, `first_response_met`, `breach`, `breach_resolved`, `paused`, `resumed`, `closed`, `reopened`) with `policy_id`, `due_at`, `previous_due_at`, `reason`, and `correlation_id`. `recomputeSla` (`inbox/sla.ts`) derives events via the pure `deriveSlaEvents` and resolves the policy via `resolveSlaPolicy` (project+channel+priority → … → tenant default). It runs after inbound/outbound/failed messages, waiting-on, priority/project/channel/status changes, assignment, transfer, close and reopen. Only real timestamps are written.
