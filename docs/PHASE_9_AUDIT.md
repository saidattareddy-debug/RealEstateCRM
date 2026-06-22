# Phase 9 Audit — Analytics & Administration

Evidence-based verification. Status: **Locally Complete & Verified**. All metrics
derive from real, RLS-scoped data; exports are logged + injection-safe; no external
network IO.

## Deliverables vs. exit criteria (`IMPLEMENTATION_PLAN.md` Phase 9)

| Exit criterion                      | Status       | Evidence                                                                                                 |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| Dashboards + reports on real data   | ✅           | `analytics.ts` reducers + `analytics/queries.ts` (RLS-scoped) + `/analytics`, `/analytics/team`          |
| Dashboard metrics reflect real data | ✅           | funnel/source/team computed live from `leads`×`pipeline_stages`×`lead_sources`×`lead_assignments`        |
| Usage / billing / limits            | ✅           | `usage_counters` + `billing_periods` + `computeUsage`/`anyOverLimit` + `/settings/usage`                 |
| Team performance                    | ✅           | `computeTeamPerformance` + `/analytics/team`                                                             |
| Integration / system health         | ✅           | `system_health_checks` + `rollupHealth` + `/admin/system-health` (no network IO)                         |
| Admin system-health page            | ✅           | `/admin/system-health` gated `system.health.read`                                                        |
| Exports (logged)                    | ✅           | `export-service.recordExport` → `analytics_export_logs` + `ANALYTICS_EXPORTED` audit; injection-safe CSV |
| Cost tracking                       | ✅ (metered) | `usage_counters` (live AI cost deferred — no live provider)                                              |

## Verified invariants

- **Tenant isolation + permission gating** — `pg-phase9.pg.test.ts`: all 4 tables
  RLS-enabled; tenant B cannot read tenant A `usage_counters`; a role without
  `billing.manage` cannot insert a billing period; status/format/used CHECKs hold.
- **No fabricated metrics** — every loader queries real tables under RLS and is
  defensive (zeros on missing rows); costs are `null` when spend is unknown.
- **Logged egress** — exports write both a ledger row and a `data_export` audit
  entry; CSV is formula-injection-safe.
- **No external IO** — `verify:no-external-io` clean; the health page never calls
  out.
- **Switches frozen** — no safety switch touched.

## Gates (executed)

format ✅ · lint 0-err ✅ · typecheck ✅ (all 5 projects) · **413 unit** ✅ (+7 analytics
domain) · **56 web** ✅ · **pg-phase9 harness 6/6** ✅ (migrations 0001–0030 + seed) ·
migration-order 0030 ✅ · secret-scan ✅ · no-external-IO ✅.

## Deferrals (`TECH_DEBT.md`)

Background usage-metering + billing-close PGMQ workers; live provider health probes
(credentials + network IO); time-series/cohort charts; live AI/WhatsApp cost
tracking (no live provider connected).
