# Performance Notes (Phase 10)

The performance practices in place and the items deferred to a hosted-staging load
test. A live, hosted performance baseline is captured by
[`PERFORMANCE_BASELINE.md`](./PERFORMANCE_BASELINE.md) (`pnpm perf:baseline`) and is
part of the NO-GO-blocking hosted-staging pack.

## In place

- **Per-request dedup** — `getAppContext` is wrapped in React `cache()` so the
  layout and page compute it once per request.
- **Concurrent queries** — server loaders dispatch independent queries with
  `Promise.all` (dashboard, auth context, analytics) rather than awaiting a chain.
- **Defensive counts** — KPI/metric loaders use head-only `count` queries
  (`safeCount`) and never block the page on a failing aggregate.
- **`force-dynamic`** on authenticated pages — no stale cached tenant data; RLS is
  always re-evaluated.
- **Indexes** — tenant-scoped composite indexes on the hot paths (leads, automations,
  follow-ups, visits, usage, notifications) accompany each migration.
- **In-database retrieval** — knowledge similarity is computed in SQL
  (`match_knowledge_chunks`), not by shipping vectors to the app.
- **No N+1 in new surfaces** — Phase 8/9 loaders aggregate with grouped queries +
  pure reducers (`@re/domain` analytics), not per-row fetches.

## Deferred to hosted staging (`TECH_DEBT.md` / `PERFORMANCE_BASELINE.md`)

- A real load test (p50/p95 latencies under concurrency) — cannot run in the
  in-sandbox build; `pnpm perf:baseline` runs against hosted staging.
- pgvector ANN index tuning (the local harness uses the portable in-SQL cosine path;
  no pgvector in embedded PG).
- Time-series/materialized analytics rollups (current dashboards compute live for
  the present period).
- Production PGMQ worker throughput for ingestion / automation / follow-up ticking.
