# Analytics & Administration (Phase 9)

Real-data dashboards and reports, usage/billing tracking, team performance, an
admin system-health view, and a logged-export ledger. Metrics are computed from
the existing RLS-scoped tables via pure `@re/domain` reducers — no fabricated
numbers, and every loader is defensive (returns zeros on a missing row, like the
dashboard's `safeCount`).

Schema: migration `0030_analytics_admin.sql`. Domain:
`packages/domain/src/analytics.ts`. Server: `apps/web/src/lib/analytics/`.

---

## 1. Metric engines (pure, `analytics.ts`)

- **`computeFunnel`** — conversion per pipeline stage (from-top and from-prev) +
  drop-off, sorted by stage order.
- **`computeSourcePerformance`** — win rate, cost-per-lead, cost-per-won (null when
  spend is unknown — never invented).
- **`computeTeamPerformance`** — win rate, average first-response minutes, open
  leads per agent.
- **`computeUsage` / `anyOverLimit`** — utilization vs plan limit, over/near-limit
  flags, remaining (unlimited = `Infinity`/`null`).
- **`rollupHealth`** — overall state = the **worst** component state (never
  optimistic).

All exhaustively unit-tested (`analytics.test.ts`).

---

## 2. Data sources (computed on the fly, under RLS)

`apps/web/src/lib/analytics/queries.ts` aggregates the existing tables under the
caller's RLS and feeds the reducers: funnel from `leads` × `pipeline_stages`
(order + is_won/is_lost); source performance from `leads` × `lead_sources`; team
performance from active `lead_assignments` (+ best-effort first-response from
conversations); usage from `usage_counters` + live-measured projects/users vs
`DEFAULT_PLAN_LIMITS` for the tenant plan; health from `system_health_checks`.

No new rollup tables are needed for funnel/source/team — they are derived live.
The new tables (`usage_counters`, `billing_periods`, `system_health_checks`,
`analytics_export_logs`) hold metered usage, billing windows, health snapshots, and
the export ledger respectively.

---

## 3. UI

| Route                  | Purpose                                                          | Permission              |
| ---------------------- | ---------------------------------------------------------------- | ----------------------- |
| `/analytics`           | KPI cards, funnel, source performance, Export CSV                | `analytics.sales.read`  |
| `/analytics/team`      | Per-agent performance, Export CSV                                | `analytics.agents.read` |
| `/settings/usage`      | Usage vs plan limits + billing periods (+ `billing.manage` edit) | `billing.read`          |
| `/admin/system-health` | Component health + overall rollup                                | `system.health.read`    |
| `/analytics/export`    | Streams CSV (overview/team); logs the export                     | `analytics.export`      |

All pages are `force-dynamic`, permission-gated, mobile-responsive, with empty and
error states and no placeholder content.

---

## 4. Logged exports (data egress)

Every CSV export goes through `export-service.ts:recordExport`, which inserts an
`analytics_export_logs` row **and** writes a `ANALYTICS_EXPORTED` (category
`data_export`) audit entry. CSV cells are formula-injection-safe (the leads-export
escaping is reused). Export logs are readable only with `settings.audit.read`.

---

## 5. System health (no network IO)

`/admin/system-health` reads the latest snapshot per component from
`system_health_checks` and rolls them up with `rollupHealth`. The page may
synthesize a deterministic, IO-free baseline (app `healthy`; unconfigured external
providers `unknown`) — it never calls out to any provider (the no-external-IO guard
stays clean).

---

## 6. Deferrals (see `TECH_DEBT.md`)

Background usage-metering + billing-period close workers (PGMQ); live provider
health probes (require credentials + network IO — a Phase-7B concern); cohort /
time-series charts beyond the current period; cost tracking for live AI/WhatsApp
usage (no live provider connected yet).
