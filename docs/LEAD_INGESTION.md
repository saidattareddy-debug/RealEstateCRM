# Lead Ingestion

How leads enter the system safely and exactly once. Authoritative behaviour is
the code under `apps/web/src/lib/leads/*`, `apps/web/src/lib/jobs/*`,
`apps/web/src/app/api/v1/leads`, `apps/web/src/app/webhooks/leads/[source]`,
`apps/web/src/app/api/forms/[formId]`, and migration `0010`.

## Principle: persist before process

Every inbound event is **written to the database before any processing**.
`lib/leads/ingest.ts#ingestLead`:

1. Computes a canonical `payload_hash` (recursive stable stringify),
   `external_event_id`, an `idempotency_key`
   (`opts.idempotencyKey ?? externalEventId ?? payloadHash`), and a
   `correlation_id`.
2. Inserts a `lead_ingestion_events` row (`status = 'received'`).
3. On a unique-constraint violation (`23505`):
   - same `payload_hash` → **idempotent hit**, returns the existing
     `resulting_lead_id` (no new work);
   - different `payload_hash` → **rejected** (same key, different payload).
4. Otherwise marks `processing`, records an attempt, runs the create-or-merge
   work, then marks `completed` with `resulting_lead_id` and writes an
   `idempotency_keys` row.
5. On error, `decideAfterFailure` schedules a retry (`next_retry_at`,
   `attempt_count`) or, once attempts are exhausted, transitions to
   `dead_letter_events`.

Because uniqueness is enforced by the database
(`unique (tenant_id, idempotency_key)` and a partial unique on
`(tenant_id, source_id, external_event_id)`), concurrent and duplicate deliveries
cannot create duplicate leads, assignments, attribution touchpoints, duplicate
candidates, activities, or audit rows.

## Ingestion statuses

`Received → Queued → Processing → Completed` on the happy path; `Rejected`
(idempotency conflict), `Retry Scheduled`, `Dead Letter`, or `Cancelled`
otherwise (enum `ingestion_status`).

## Durable-job abstraction (`lib/jobs/*`)

A driver-agnostic queue: a job repository, a `JobProcessor` interface, and three
drivers:

- **`SyncLocalDriver`** — enqueues and drains inline for local development. It is
  **explicitly not a production background worker**.
- **`OutboxDriver`** — PostgreSQL outbox table for at-least-once handoff.
- **`PgmqDriver`** — interface for the production PGMQ queue; **throws until a
  live Supabase/PGMQ stack exists** (accepted deferral).

Retry backoff, max attempts, dead-letter transition, manual replay
(`replayDeadLetter`), and correlation IDs are implemented at this layer.

## HTTP surfaces

| Surface                         | Auth                                                     | Notes                                                                                                                             |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/leads`            | `x-form-id` + hashed `x-api-key` (constant-time compare) | timestamp tolerance, per-key rate limit, 32 KB cap, `idempotency-key` header, versioned response `{ok, version, requestId, data}` |
| `POST /webhooks/leads/[source]` | hashed api-key **or** HMAC signature                     | adapter per source; synthetic adapters for generic, NoBroker, 99acres, Housing, Meta-lead, Google-lead                            |
| `POST /api/forms/[formId]`      | public, credential-light                                 | origin allow-list, 16 KB cap, rate limit, timestamp replay window, honeypot (silent 202), consent capture, correlation id         |

All HTTP ingestion routes **persist the event before processing** and return
**non-disclosing** responses: a public form never reveals whether a phone/email
already exists, and never exposes internal tenant IDs or database errors.

## Sources

`resolveSourceId` resolves a `lead_sources` row by channel **kind**, creating the
channel row on first use (e.g. the first NoBroker lead creates the "NoBroker"
source). This is an ingestion _channel_, not a business entity — ingestion and
import never silently create projects, agents, campaigns, or pipeline stages.

## Attribution

First-touch attribution is captured once and **never overwritten**. Subsequent
events for the same lead append a last-touch touchpoint while preserving the
original first-touch row.
