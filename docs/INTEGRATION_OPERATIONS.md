# Integration Operations (Phase 7A)

This document describes the operational surface of the integration foundation:
connection lifecycle, health, sync cursors, rate-limit state, replay, and the
permission-gated operator UI.

> **Phase 7A status.** The operational surface is **mock / simulation /
> record-only** and exercised with **synthetic fixtures**. Phase 7A performs **no
> external IO**, connects to **no live provider**, and runs no production queue or
> production monitoring. Health, sync, and rate-limit state are **synthetic**. The
> frozen safety switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
> `RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
> outbox, automatic customer sending impossible). Production operations are **Phase
> 7B**.

---

## 1. Connection lifecycle

`integration_connections` (and `integration_connection_versions`) hold the
connection catalogue. The status enum is `draft`, `unconfigured`, `test`,
`connected`, `degraded`, `disabled`, `revoked`, `error` — but a DB
`CHECK (status <> 'connected')` makes the `connected` status **unreachable in
7A**. The domain mirrors this with `PHASE_7A_ALLOWED_STATUSES`
(`draft`, `unconfigured`, `test`, `disabled`).

Each tenant is seeded a synthetic `manual_test` connection (status `test`, health
`unknown`) so the surface is populated without any live provider.

Connection mutations are audited: `integration.created`, `integration.updated`,
`integration.disabled` (security), and the verification-attempt /
succeeded / failed actions (verification is **simulated** in 7A).

## 2. Health

- `integration_health_events` records health transitions; the current state lives
  on `integration_connections.health_state`.
- `computeHealthState(input)` returns `healthy`, `degraded`, `failing`,
  `expired`, `revoked`, `disabled`, `unconfigured`, or `unknown`. Crucially it is
  **never `healthy` on configuration alone** — health reflects observed
  success/failure, so an unexercised connection is `unknown`, not healthy.
- Health changes are audited as `integration.health.changed`.

## 3. Sync cursors and rate-limit state

- `integration_sync_cursors` — per-connection cursor key/value for incremental
  sync (synthetic in 7A).
- `integration_rate_limit_states` — per-window count / `limited` flag for client
  rate-limiting (synthetic in 7A).

Real sync and real rate-limit enforcement against a live provider are **Phase
7B**.

## 4. Events, failures, dead-letters, replay

The event-operations tables (`external_events`, `external_event_attempts`,
`external_event_failures`, `external_event_dead_letters`,
`external_event_replays`) give operators a record of every normalized event,
attempt, failure, dead-letter, and replay. Replay is governed by `decideReplay`
(permission + reason + event + idempotent) and requires the
`integrations.events.replay` permission; it is audited as
`integration.event.replayed` (security).

**Durable-queue execution** (retry/backoff, DLQ processing, replay execution on
PGMQ) is **deferred to Phase 7B** — in 7A the decisions are exercised but the
existing local-sync job abstraction stands in; there is no production queue or
production monitoring.

## 5. Operator UI

The operator surface is permission-gated (see [`PAGE_MAP.md`](./PAGE_MAP.md) and
[`PERMISSIONS_MATRIX.md`](./PERMISSIONS_MATRIX.md)):

- `/settings/integrations` (and sub-pages) — connection list/detail, channel
  config, WhatsApp accounts/numbers/templates, email mailboxes/parsing rules, and
  source mappings, gated on `integrations.read` / `integrations.manage` /
  `integrations.mappings.manage` and the channel keys.
- `/integrations/events` — the external-event log (read gated on
  `integrations.events.read`; replay on `integrations.events.replay`).

Every page is **record-only**: nothing in the UI connects to a live provider or
sends a customer-facing message. The exact server/UI file inventory is reconciled
by the parent agent; the surface is described here honestly as mock / simulation /
record-only.

## 6. What is Phase 7B

Live connection verification, real health from real providers, real sync + rate
limits, production PGMQ queues, production monitoring, and any live IO — all
**Phase 7B**.

See [`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md),
[`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md), and
[`DEPLOYMENT.md`](./DEPLOYMENT.md).
