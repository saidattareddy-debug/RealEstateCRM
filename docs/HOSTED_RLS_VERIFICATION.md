# Hosted RLS Verification

Non-destructive Row-Level-Security verification on a **staging** Supabase project. Mirrors the
349-assertion embedded-PG harness, but runs against real hosted infrastructure. **Never resets the
database** and **refuses to run against production**.

## Runner

`scripts/hosted-rls-verification.mjs` (`pnpm hosted:rls`).

Requires:

- `STAGING_ONLY_ACK=yes` — explicit acknowledgement (refuses otherwise)
- `STAGING_DATABASE_URL` — staging Postgres connection string
- refuses if `EXPECTED_ENV=production`

It creates **two** temporary, uniquely-prefixed test tenants (`rlscheck_<ts>_…`) and role users,
runs the checks below as each role, then deletes **only** the prefix-scoped rows it created.

## Checks (each asserts zero cross-tenant visibility unless noted)

1. Tenant isolation — tenant B cannot read tenant A rows.
2. Assigned-lead access — an agent sees only assigned/owned leads.
3. Conversation access — visibility follows lead ownership/assignment.
4. Project & inventory isolation — per tenant.
5. Task access — per tenant + assignment.
6. Scoring isolation — scores/signals are tenant-scoped.
7. Matching isolation — match runs/results are tenant-scoped.
8. Integration-metadata isolation — connections/events/channels are tenant-scoped.
9. Platform administrator has **no silent tenant access** (must use an explicit, audited path).

## Output

- `docs/HOSTED_RLS_VERIFICATION.result.json` — machine-readable
- `docs/HOSTED_RLS_VERIFICATION.result.md` — human-readable
- Exit code 0 = PASS, 1 = FAIL, 2 = refused (missing ack / production target)

## Production note

There is intentionally **no** production mode in this script. Verifying RLS against production
requires a separate, reviewed, read-only procedure — never the synthetic-tenant create/cleanup
flow used here.
