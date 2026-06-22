# Performance Baseline

Conservative, **staging-only** latency baseline. Not a load/stress test — sequential, low volume.
Set monitoring/alert thresholds from the **measured** values, not guesses.

## Runner

`scripts/staging-performance-baseline.mjs` (`pnpm perf:baseline`).

Requires `STAGING_ONLY_ACK=yes`, `STAGING_BASE_URL`, `STAGING_SESSION_COOKIE` (server-only; never
hard-coded). `SAMPLES` defaults to 5. Output: `docs/PERFORMANCE_BASELINE.result.json`.

## Pages / endpoints measured

Dashboard, lead list, lead detail, pipeline, tasks, inbox, conversation detail, project list,
project detail, inventory, scoring panel, matching panel, audit log, `/api/health`
(and website-chat ingestion measured separately via the widget endpoint).

## Metrics recorded (per page)

Median, P95, P99 (where meaningful), error rate, request count; plus, where available, DB query
duration, cold-start vs warm response, and process memory.

## Results table (fill from `…result.json`)

| Page / endpoint     | Median (ms) | P95 (ms) | P99 (ms) | Error rate | Notes (cold/warm) |
| ------------------- | ----------- | -------- | -------- | ---------- | ----------------- |
| /dashboard          |             |          |          |            |                   |
| /leads              |             |          |          |            |                   |
| /leads (detail)     |             |          |          |            |                   |
| /pipeline           |             |          |          |            |                   |
| /tasks              |             |          |          |            |                   |
| /inbox              |             |          |          |            |                   |
| conversation detail |             |          |          |            |                   |
| /projects           |             |          |          |            |                   |
| project detail      |             |          |          |            |                   |
| /inventory          |             |          |          |            |                   |
| scoring panel       |             |          |          |            |                   |
| matching panel      |             |          |          |            |                   |
| /settings/audit-log |             |          |          |            |                   |
| website-chat ingest |             |          |          |            |                   |
| /api/health         |             |          |          |            |                   |

## Acceptance

Define acceptable thresholds with the operations owner (e.g. P95 interactive pages < target ms,
error rate ~0). Record the agreed thresholds here; they become the alert thresholds. Unacceptable
or unmeasured performance keeps production promotion at **NO-GO**.
