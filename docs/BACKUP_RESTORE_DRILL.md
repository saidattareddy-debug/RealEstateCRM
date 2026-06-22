# Backup & Restore Drill

Proves backups are real and recoverable **before** production promotion. Restore always targets a
**disposable** recovery project — never staging or production data. **Never** run
`supabase db reset` on a project holding real data.

## Procedure

1. **Confirm backups enabled** — In the Supabase project: automated daily backups **and** PITR
   are on; note the retention window.
2. **Create / identify a recovery point** — Record a PITR timestamp (or the latest backup id).
3. **Restore into a disposable recovery project** — Create a throwaway project and restore the
   chosen recovery point into it. (Restore here is **[DESTRUCTIVE]** — disposable env only.)
4. **Verify migration level** — `supabase migration list` (linked to the recovery project) shows
   `0001–0026`, no gaps. (Or `pnpm verify:migrations` against the dumped schema.)
5. **Verify row counts** — Compare key table counts (tenants, leads, conversations, projects,
   inventory_units, audit_log) against the source snapshot; differences explained by the recovery
   point only.
6. **Verify tenant isolation after restore** — Run the hosted RLS checks
   (`HOSTED_RLS_VERIFICATION.md`) against the recovery project.
7. **Run the smoke subset** — Sign in + load core pages + `/api/health` against the recovery app.
8. **Record recovery time (RTO)** — restore start → app serving.
9. **Record recovery point (RPO)** — gap between the recovery point and the incident time target.
10. **Destroy the recovery project** — Delete it; confirm deletion. Record who/when.

## Evidence template

| Field                       | Value       |
| --------------------------- | ----------- |
| Backup source (project/ref) |             |
| Backup timestamp / PITR     |             |
| Restore destination (ref)   |             |
| Restore start (UTC)         |             |
| Restore end (UTC)           |             |
| Migration level verified    | 0001–0026 ☐ |
| Row-count verification      | PASS / FAIL |
| Tenant-isolation re-check   | PASS / FAIL |
| Smoke subset                | PASS / FAIL |
| RTO (mm:ss)                 |             |
| RPO (target / achieved)     |             |
| Recovery project destroyed  | ☐ yes       |
| Tester                      |             |
| Approver                    |             |
| Issues discovered           |             |

A failed or unverified restore keeps production promotion at **NO-GO**.
