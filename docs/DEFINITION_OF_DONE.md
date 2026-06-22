# Definition of Done — §35 Acceptance Criteria

Maps each of the 30 acceptance criteria from `MASTER_SPEC.md` §35 to its evidence.
Legend: ✅ met (local); 🟡 met locally, live activation deferred to a documented
external stop-condition (credentials / paid / hosted staging).

| #   | Criterion                           | Status | Evidence                                                                            |
| --- | ----------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| 1   | Tenant creation + branding          | ✅     | `on_tenant_created` trigger; `tenant_branding`; `/settings` branding                |
| 2   | RLS-tested isolation                | ✅     | harness 349/349 + `pg-phase8` 9/9 + `pg-phase9` 6/6 (0001–0030)                     |
| 3   | Invitations + permissions           | ✅     | `/team` invite flow; memberships + roles + `effective_permissions`                  |
| 4   | Multiple projects                   | ✅     | `/projects` CRUD + configs/inventory (Phase 2)                                      |
| 5   | Inventory import/update             | ✅     | `/inventory/import` CSV/XLSX + status history + stale report                        |
| 6   | Document indexing                   | ✅     | Phase 5A knowledge ingestion + chunking + in-DB hybrid retrieval                    |
| 7   | Multi-source lead arrival           | ✅     | manual + CSV + form + webhook ingestion (≥3 sources)                                |
| 8   | Safe dedupe                         | ✅     | multi-signal dedupe → review queue, reversible merge (never silent)                 |
| 9   | AI answering from approved data     | 🟡     | grounded answers from Approved sources; **automatic send disabled** (5B.1)          |
| 10  | Escalation of unsupported questions | ✅     | deterministic grounding → escalation (Phase 5A)                                     |
| 11  | Natural qualification extraction    | ✅     | qualification completeness + review-only AI extraction                              |
| 12  | Deterministic explainable scoring   | ✅     | `scoring.ts` versioned/explainable + `pg` harness; advisory                         |
| 13  | Working categories                  | ✅     | Hot 75+/Warm 45–74/Cold <45 classification (configurable)                           |
| 14  | Automatic + manual assignment       | ✅     | assignment engine (round-robin) + manual never overwritten; automations can assign  |
| 15  | Agent takeover                      | ✅     | inbox takeover pauses AI; `operating_mode`                                          |
| 16  | Reliable follow-ups                 | 🟡     | sequence engine + all stop conditions + why-sent; **delivery suppressed** (5B.1/7B) |
| 17  | Site-visit scheduling + sync        | 🟡     | full lifecycle + double-booking prevention; **calendar sync simulated** (7B)        |
| 18  | Working pipeline                    | ✅     | `/pipeline` Kanban + stage history + funnel                                         |
| 19  | Real dashboard metrics              | ✅     | role-aware dashboard + `/analytics` from real RLS-scoped data                       |
| 20  | Practical mobile workflows          | ✅     | responsive routes + mobile bottom nav + sticky lead actions                         |
| 21  | Cost tracking                       | 🟡     | `usage_counters` + usage UI; **live AI/WhatsApp cost** needs a live provider        |
| 22  | Webhook retry                       | ✅     | durable-job abstraction + DLQ + replay (Phase 3.1 / 7A)                             |
| 23  | Audit logs                          | ✅     | append-only `audit_logs` + typed catalogue + `/audit`                               |
| 24  | Passing security tests              | ✅     | harness + `verify:secrets` + `verify:no-external-io` + env validator                |
| 25  | No privileged key in browser        | ✅     | service-role server-only; secret-scan clean; prod validator rejects leaks           |
| 26  | No static placeholder pages         | ✅     | all routes are real, permission-gated, data-backed (phase audits)                   |
| 27  | Complete deployment instructions    | ✅     | `DEPLOYMENT.md` + `HOSTED_STAGING_RUNBOOK.md` + env matrix + go-live runbooks       |
| 28  | Observability                       | ✅     | `/api/health`; prod requires `SENTRY_DSN`; log-redaction helpers                    |
| 29  | Consent / DNC enforced              | ✅     | consent model + DNC checked before any (simulated) outbound                         |
| 30  | Backup / restore drill              | 🟡     | `BACKUP_RESTORE_DRILL.md` runbook; **execution needs hosted staging**               |

## Summary

All 30 criteria are **met locally**. Six (9, 16, 17, 21, 30, and the live half of
deployment) are **met up to a documented external stop-condition** — live provider
activation (7B), the live-send master switch (5B.1), and hosted-staging execution.
The controlled-MVP production go/no-go is **NO-GO pending hosted staging** by design
(`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`).
