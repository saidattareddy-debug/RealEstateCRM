# Hosted Staging Runbook

Exact operator steps to verify the Controlled MVP on hosted infrastructure. Production status
stays **NO-GO** until every step here passes and a named human signs off (see
`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`). Each command is tagged:

- **[LOCAL]** safe to run on a developer machine
- **[CI]** safe in CI
- **[STAGING]** safe against the staging project
- **[PROD]** safe against production
- **[DESTRUCTIVE]** disposable/throwaway environments only

> **Never** run `supabase db reset` against staging or production — it drops data. It is
> **[DESTRUCTIVE]** and allowed only on a disposable local or recovery project.

## 0. Preconditions

- Repo at the approved commit; all local gates green (`§15` of the audit).
- Supabase CLI authenticated; access to two **separate** Supabase projects (staging, production).
- Secrets manager holding distinct secret sets per environment (see `ENVIRONMENT_MATRIX.md`).

## 1. Create the staging Supabase project — [STAGING]

Create a new project (e.g. `recrm-staging`). Record its **project ref**. Enable: Postgres,
`pgvector` (or confirm portable fallback), automated backups + PITR.

## 2. Create the production Supabase project — [PROD]

Create a separate project (e.g. `recrm-prod`) with its **own** ref and **own** secrets. Confirm:

```bash
# [LOCAL] confirm the two refs are different before linking
test "$STAGING_REF" != "$PROD_REF" && echo "OK distinct" || echo "FAIL same ref"
```

Confirm the service-role keys, anon keys, and app secrets differ between the two projects
(`ENVIRONMENT_MATRIX.md`). **Production secrets must never equal staging secrets.**

## 3. Configure authentication URLs

- **[STAGING]** Set Site URL + redirect/callback URLs to the staging app origin (https).
- **[PROD]** Set Site URL + redirect/callback URLs to the production app origin (https).
- Configure secure cookies, session expiry, password-reset + invitation redirect URLs.

## 4. Configure the application deployment

Set environment variables per `ENVIRONMENT_MATRIX.md` in the hosting provider (staging first):
`APP_ENV`, `DEPLOYMENT_PROFILE=controlled_mvp`, Supabase URL/anon/service-role,
`NEXT_PUBLIC_APP_URL`, `SESSION_SIGNING_SECRET`, `SENTRY_DSN`, and the four gates kept **false**.
Startup fails fast if production config is incomplete (`assertDeploymentReady`).

## 5. Apply migrations — FORWARD-ONLY — [STAGING] then [PROD]

```bash
# [LOCAL/CI] read-only preflight (verifies sequence + gates; applies nothing)
TARGET_ENV=staging EXPECTED_SUPABASE_PROJECT_REF=$STAGING_REF \
  NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_APP_URL=https://staging... \
  pnpm db:staging:preflight

# [STAGING] apply forward-only (manual, after preflight passes)
supabase link --project-ref $STAGING_REF
supabase db push        # forward-only; NEVER `supabase db reset`
```

Repeat with `db:production:preflight` + `supabase db push` against `$PROD_REF` for production.

## 6. Create the initial bootstrap tenant + administrator — [STAGING]/[PROD]

Do **not** load broad synthetic seed into production. Create exactly one approved bootstrap
tenant and one Client Admin via the approved provisioning path. For staging, seed the role
fixtures needed by §9–§11.

## 7. Verify environment status

```bash
# [STAGING] liveness/readiness + safety posture (no secrets returned)
curl -s https://staging.../api/health | jq
# expect: profile=controlled_mvp, publicWebhooks=disabled, liveSending=disabled
```

In the app, open **Settings → Integrations → Environment status** and confirm every external
integration renders disabled/simulation.

## 8. Run hosted RLS verification — [STAGING]

```bash
STAGING_ONLY_ACK=yes EXPECTED_ENV=staging STAGING_DATABASE_URL=postgres://... \
  pnpm hosted:rls
```

Produces `docs/HOSTED_RLS_VERIFICATION.result.{json,md}`. Must be PASS. See
`HOSTED_RLS_VERIFICATION.md`.

## 9. Run the browser smoke test — [STAGING]

Follow `CONTROLLED_MVP_SMOKE_TEST.md` (35 steps) manually, and run the automated subset:

```bash
# [STAGING] install browsers once, then run the skeleton
pnpm exec playwright install chromium
E2E_BASE_URL=https://staging... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
  pnpm exec playwright test -c e2e/playwright.config.ts
```

## 10. Run backup + restore validation — [DESTRUCTIVE recovery project]

Follow `BACKUP_RESTORE_DRILL.md`: restore the latest backup into a **disposable** recovery
project, verify migration level + row counts + tenant isolation, run the smoke subset, record
RTO/RPO, then destroy the recovery project.

## 11. Record observability evidence — [STAGING]

Confirm Sentry receives a test exception, the uptime monitor polls `/api/health`, and structured
logs reach the destination **with secrets redacted** (`packages/validation/src/redaction.ts`).

## 12. Record performance evidence — [STAGING]

```bash
STAGING_ONLY_ACK=yes STAGING_BASE_URL=https://staging... STAGING_SESSION_COOKIE=... \
  pnpm perf:baseline
```

Record medians/P95 in `PERFORMANCE_BASELINE.md`; set monitor thresholds from measured values.

## 13. Record human approval

Complete the **Named approval** section of `CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`. Only after every
step above passes and all approvers sign may the status change to _Production Controlled MVP
Approved_ (see the Promotion Rule in the audit).
