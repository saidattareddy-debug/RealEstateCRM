# Phase 1 Audit

**Date:** 2026-06-19 · **Scope:** Foundation (repo, app shell, auth, tenancy, RLS, roles/permissions, branding) audited against [`MASTER_SPEC.md`](./MASTER_SPEC.md), [`../CLAUDE.md`](../CLAUDE.md), the Phase 0 architecture docs, and the §35 Definition of Done. **No new product features were added during this audit.** Two defects found during the audit were fixed (env-access bug, formatting gate) and are documented below.

**Environment note:** The connected-folder mount blocks `unlink`, so dependencies/build/run were exercised on a sandbox-local clone of the committed repo. Supabase CLI, Docker and a system Postgres are **absent** from the sandbox, so live Supabase steps were executed against an **embedded Postgres** with a stubbed `auth` schema (see §RLS result). The official `supabase start` / `supabase test db` path must still be run on a Docker-capable machine.

---

## 1. Headline result

| Gate                                       | Result                                |
| ------------------------------------------ | ------------------------------------- |
| Clean install (`--frozen-lockfile`)        | ✅ reproducible                       |
| Format check                               | ✅ pass (after remediation)           |
| Lint                                       | ✅ pass                               |
| Typecheck (all packages + web)             | ✅ pass                               |
| Unit tests                                 | ✅ 13/13                              |
| Migrations apply from clean DB (0001→0004) | ✅ (pgvector line skipped in harness) |
| RLS / tenant-isolation assertions          | ✅ 17/17 (equivalent harness)         |
| Production build                           | ✅ 8 routes                           |
| App starts + protected routes redirect     | ✅ verified at runtime                |
| Secrets absent from client bundle          | ✅ verified                           |

**Phase 2 readiness: GO**, conditional on three tracked debts (audit-log tables, loading/error route boundaries, mobile bottom-nav) and running the official `supabase test db` locally. None block Phase 2 work.

---

## 2. Requirement-by-requirement status

| #   | Requirement (audit ask)                                 | Status       | Evidence / files                                                                                                                                                                                     |
| --- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Install deps from root via pnpm                         | ✅           | `pnpm install --frozen-lockfile` → exit 0, 272 pkgs, "Done in 1.1s"                                                                                                                                  |
| 2   | Formatting checks                                       | ✅ (fixed)   | `pnpm format:check`; initially failed on 24 files → added `.prettierignore` + `prettier --write` → "All matched files use Prettier code style!"                                                      |
| 3   | Linting                                                 | ✅           | `pnpm lint` (`eslint .`) exit 0                                                                                                                                                                      |
| 4   | Typecheck every package                                 | ✅           | `pnpm -r typecheck` → config, validation, domain, ui, web all "Done"; exit 0                                                                                                                         |
| 5   | Unit tests                                              | ✅           | `pnpm test` → `packages/domain` 13/13                                                                                                                                                                |
| 6   | Start Supabase + apply migrations from clean DB         | ◑ equivalent | Supabase CLI/Docker absent; embedded-Postgres harness applied `0001`–`0004` in order + seed from empty DB. `create extension vector` skipped (extension unavailable in harness; present on Supabase) |
| 7   | pgTAP / RLS tests                                       | ◑ equivalent | `supabase test db` not runnable (no Docker). Live RLS harness: **17/17 pass**. Authored pgTAP suite `supabase/tests/0001_rls_tenant_isolation_test.sql` still to run via `supabase test db`          |
| 8   | Production build                                        | ✅           | `pnpm build` → "Compiled successfully", 8 routes, exit 0                                                                                                                                             |
| 9   | App starts                                              | ✅           | `next start` → `GET /sign-in` HTTP 200                                                                                                                                                               |
| 10  | Auth connected to Supabase (not mocked)                 | ✅           | `signInWithPassword`, `auth.getUser`, `auth.signOut` in `apps/web/src/app/(auth)/actions.ts`, `lib/auth.ts`, `lib/supabase/middleware.ts`                                                            |
| 11  | Protected routes blocked without auth                   | ✅           | `/dashboard`, `/team`, `/settings`, `/` → HTTP 307 → `/sign-in` (unauthenticated)                                                                                                                    |
| 12  | Tenant resolution server-enforced                       | ✅           | `middleware.ts` (server/edge) + `getAppContext()` (server) redirect; active tenant from **httpOnly cookie + JWT `app_metadata.active_tenant`**, validated against `memberships` server-side          |
| 13  | Cross-tenant query/update/delete blocked                | ✅           | RLS harness: cross-tenant SELECT=0 rows, UPDATE=0 rows, DELETE=0 rows, INSERT=RLS violation                                                                                                          |
| 14  | Role/permission checks not browser-only                 | ✅           | DB `has_permission()`/`effective_permissions()` (SECURITY DEFINER) + RLS + server `ensurePermission()`; browser only filters nav cosmetically                                                        |
| 15  | No service-role/DB/integration secret in client bundle  | ✅           | `grep .next/static`: service-role value, `SUPABASE_SERVICE_ROLE_KEY`, `service_role` → NOT FOUND; anon key present (public, expected)                                                                |
| 16  | Env vars validated + documented                         | ✅           | `packages/config/src/env.ts` (Zod, fail-fast, client/server split); `.env.example` documents all vars w/ SERVER-ONLY markings                                                                        |
| 17  | loading/error/empty/permission-denied states            | ◑ partial    | permission-denied ✅ (`team`,`settings`), empty ✅ (`dashboard`,`team`); **loading.tsx/error.tsx route boundaries missing** (debt)                                                                   |
| 18  | Desktop shell + mobile nav responsive                   | ◑ partial    | Desktop sidebar `hidden md:flex`, responsive topbar ✅; **mobile bottom-nav not implemented** (debt)                                                                                                 |
| 19  | No hardcoded users/tenant IDs/permissions/creds         | ✅           | No UUIDs/creds in `apps`/`packages` source; fixed UUIDs only in synthetic `supabase/seed/seed.sql` (documented)                                                                                      |
| 20  | TODO/FIXME/placeholder/mocked/temporary/hardcoded       | ✅           | Only 2 benign matches (a doc comment "no placeholder/dead links"; a seed comment "password hash is a placeholder, local dev"). No TODO/FIXME/mocked code                                             |
| 21  | Migrations ordered, repeatable from clean DB, committed | ✅           | `0001`–`0004` applied in order from empty DB; committed in `supabase/migrations/`. Designed for `supabase db reset` (clean), not in-place re-run                                                     |
| 22  | Audit logging for security-sensitive Phase 1 ops        | ❌ gap       | No `audit_logs`/`security_events` tables/triggers in Phase 1 migrations. Supabase Auth logs auth events internally; app-level audit not yet implemented (debt)                                       |
| 23  | Branding ready for per-client white-label               | ✅           | Runtime CSS-var override (`(app)/layout.tsx` `brandStyle`), `tenant_branding` + `white_label` flag, `settings` page renders live colours                                                             |
| 24  | Update BUILD_STATUS truthfully                          | ✅           | [`BUILD_STATUS.md`](./BUILD_STATUS.md) updated                                                                                                                                                       |

Legend: ✅ pass · ◑ partial / equivalent · ❌ gap.

---

## 3. Commands executed — exact result summaries

```text
$ pnpm install --frozen-lockfile
  Packages: +272 ; "Done in 1.1s using pnpm v9.15.9"            -> exit 0

$ pnpm format:check        (before remediation)
  [warn] 24 files (docs/*.md, eslint.config.mjs, apps/web/tailwind.config.ts,
         pnpm-lock.yaml, pnpm-workspace.yaml, CLAUDE.md, README.md)
  ELIFECYCLE Command failed with exit code 1                    -> FAIL
  (remediated: added .prettierignore for pnpm-lock.yaml + prettier --write)
$ pnpm format:check        (after remediation)
  "All matched files use Prettier code style!"                  -> exit 0

$ pnpm lint                (eslint .)                            -> exit 0 (clean)
   warning surfaced during build: "Next.js plugin was not detected in ESLint config"

$ pnpm -r typecheck        (tsc --noEmit per project)
  config / validation / domain / ui / apps-web : all "Done"     -> exit 0

$ pnpm test                (vitest run)
  packages/domain/src/__tests__/rbac.test.ts (13 tests)  ✓
  Test Files 1 passed (1) ; Tests 13 passed (13)                -> exit 0

$ pnpm build               (next build)
  ✓ Compiled successfully ; ✓ Generating static pages (8/8)
  Routes: / (○)  /_not-found (○)  /dashboard (ƒ)  /settings (ƒ)
          /sign-in (○)  /team (ƒ) ; Middleware 76.3 kB           -> exit 0

$ next start  +  curl                                           (runtime checks)
  GET /sign-in   -> 200
  GET /dashboard -> 307  Location: /sign-in
  GET /team      -> 307  Location: /sign-in
  GET /settings  -> 307  Location: /sign-in
  GET /          -> 307  Location: /sign-in

$ node run.mjs   (embedded-Postgres RLS harness; migrations 0001-0004 + seed)
  17 passed, 0 failed                                           -> exit 0
```

**Build result:** ✅ optimized production build; `/dashboard`, `/team`, `/settings` are dynamic (server-rendered on demand), `/` and `/sign-in` static, middleware bundled (76.3 kB).

---

## 4. RLS / tenant-isolation test result (exact)

Executed against a real embedded PostgreSQL with a stubbed Supabase `auth` schema (`auth.users`, `auth.uid()`, `auth.jwt()`, `auth.role()` reading JWT-claim GUCs), all four migrations applied in order from an empty database, then the synthetic seed. Queries run as the non-superuser `authenticated` role (so RLS applies), with per-user `request.jwt.claims` + `app.current_tenant`.

```text
PASS migration applied: 0001_extensions.sql        (pgvector line skipped)
PASS migration applied: 0002_identity_tenancy.sql
PASS migration applied: 0003_auth_context.sql
PASS migration applied: 0004_roles_seed_and_rls.sql
PASS seed applied
PASS RLS SELECT: A-admin sees exactly 1 branding row (own tenant)   count=1
PASS RLS SELECT: A-admin cannot see Skyline tenant                  count=0
PASS RLS UPDATE: A-admin cannot update Skyline branding             rows=0
PASS RLS DELETE: A-admin cannot delete Skyline tenant               rows=0
PASS RLS INSERT: A-admin cannot insert feature for Skyline          (RLS violation)
PASS RLS SELECT: B-admin sees only Skyline branding                 count=1
PASS effective_permissions: A-admin has scoring.publish
PASS has_permission(settings.branding.manage) true for A-admin
PASS agent lacks leads.read.all
PASS project_maintenance role excludes conversations.read.private
PASS tenant-creation trigger seeded default roles                   roles=6
PASS RLS enabled on tenant tables                                   tables_with_rls=11
==== SUMMARY: 17 passed, 0 failed ====
```

**Caveat:** this is an _equivalent_ harness, not the official `supabase test db` run. The authored pgTAP file is committed and should be executed locally to confirm parity. `pgvector` extension creation was skipped because the embedded Postgres lacked it; the remainder of `0001` (pgcrypto, citext, pg_trgm, `set_updated_at`) and all of `0002`–`0004` ran unmodified.

---

## 5. Route inventory

| Route                                          | Access level               | Required permission         | Server-side enforcement                                       | Status                        |
| ---------------------------------------------- | -------------------------- | --------------------------- | ------------------------------------------------------------- | ----------------------------- |
| `/`                                            | Public → redirect          | —                           | `redirect('/dashboard')` in page; middleware auth gate        | ✅ implemented                |
| `/sign-in`                                     | Public (unauth)            | —                           | Middleware allows; Server Action `signInAction` (Supabase)    | ✅ implemented                |
| `/dashboard`                                   | Authenticated (any member) | — (membership)              | Middleware `getUser` redirect + `getAppContext()` redirect    | ✅ implemented                |
| `/team`                                        | Authenticated              | `team.performance.read`     | Middleware + server `ensurePermission()` → `PermissionDenied` | ✅ implemented                |
| `/settings`                                    | Authenticated              | `settings.org.manage`       | Middleware + server `ensurePermission()` → `PermissionDenied` | ✅ implemented                |
| Server Action `signInAction` / `signOutAction` | Public / Authenticated     | —                           | Server-only action, Supabase auth                             | ✅ implemented                |
| Server Action `setActiveTenantAction`          | Authenticated              | membership of target tenant | Server-only; validates `memberships` before switch            | ✅ implemented                |
| `/forms/*`, `/chat/*`                          | Public (reserved)          | —                           | Listed as public prefixes in middleware                       | ⬜ not present (later phases) |
| `/api/v1/*`, `/webhooks/*`                     | —                          | per endpoint                | —                                                             | ⬜ not present (later phases) |
| Platform admin area `/(platform)`              | Super Admin                | `platform.*`                | —                                                             | ⬜ not present (later phases) |

All implemented protected routes were confirmed to 307-redirect to `/sign-in` when unauthenticated.

---

## 6. RLS inventory

All tenant tables have RLS **enabled** (verified: 11 tables). Write policies are `FOR ALL` (cover INSERT/UPDATE/DELETE) and combine `tenant_id = current_tenant_id()` with a permission check; read policies use membership.

| Table                   | SELECT                                          | INSERT / UPDATE / DELETE                     | Tenant-isolation test coverage                  |
| ----------------------- | ----------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| `tenants`               | platform admin OR active member                 | platform admin only (`tenants_write`)        | ✅ direct (SELECT hidden, DELETE 0 rows)        |
| `tenant_branding`       | platform admin OR member                        | `settings.branding.manage` + active tenant   | ✅ direct (SELECT 1-own, UPDATE 0 cross)        |
| `tenant_settings`       | platform admin OR member                        | `settings.org.manage` + active tenant        | ◑ pattern-covered (same policy shape)           |
| `tenant_features`       | platform admin OR member                        | `settings.org.manage` + active tenant        | ✅ direct (INSERT cross → RLS violation)        |
| `profiles`              | self / co-member / platform admin               | UPDATE self only; INSERT/DELETE default-deny | ◑ pattern-covered                               |
| `permissions` (catalog) | any authenticated                               | none (deny; seeded by migration)             | n/a (global static)                             |
| `roles`                 | platform admin OR member of role's tenant       | `settings.roles.manage` + active tenant      | ✅ indirect (seed count, maintenance exclusion) |
| `role_permissions`      | via parent role visibility                      | `settings.roles.manage` + active tenant      | ✅ indirect (project_maintenance check)         |
| `memberships`           | self / `team.performance.read` / `users.manage` | `users.manage` + active tenant               | ◑ pattern-covered                               |
| `user_permissions`      | self / `settings.roles.manage`                  | `settings.roles.manage` + active tenant      | ◑ pattern-covered                               |
| `invitations`           | `users.invite` + active tenant                  | `users.invite` + active tenant               | ◑ pattern-covered                               |

✅ direct = explicitly asserted in the harness; ◑ pattern-covered = same policy construction as a directly-tested table. **Recommendation:** extend the pgTAP suite to assert each table directly before Phase 10 hardening.

---

## 7. Permission matrix (default role bundles, as implemented)

Source of truth: `packages/validation/src/permissions.ts` + `supabase/migrations/0004_roles_seed_and_rls.sql` (verified consistent). Scopes: ✅ full · 🟡 scoped/conditional · ➖ none.

| Capability                                                | Super Admin | Client Admin | Marketing Mgr |    Sales Mgr    | Sales Agent | Project Data & Maint. |     Viewer     |
| --------------------------------------------------------- | :---------: | :----------: | :-----------: | :-------------: | :---------: | :-------------------: | :------------: |
| Platform: tenants/plans/domains/health/models/impersonate |     ✅      |      ➖      |      ➖       |       ➖        |     ➖      |          ➖           |       ➖       |
| Tenant settings & branding                                |     ➖      |      ✅      |      ➖       |       ➖        |     ➖      |          ➖           |       ➖       |
| Manage roles / invite users                               |     ➖      |      ✅      |      ➖       |    🟡 agents    |     ➖      |          ➖           |       ➖       |
| Campaigns / sources / forms / marketing analytics         |     ➖      |      ✅      |      ✅       |       ➖        |     ➖      |          ➖           |    🟡 read     |
| Pipeline config / assignment config                       |     ➖      |      ✅      |      ➖       |       ✅        |     ➖      |          ➖           |       ➖       |
| Read leads                                                |     ➖      |    ✅ all    |    🟡 team    |     ✅ team     | 🟡 assigned |          ➖           |    🟡 team     |
| Read **private** conversations                            |     ➖      |      ✅      |      ➖       |       ✅        | 🟡 assigned |        **➖**         |       ➖       |
| Reply / take over conversations                           |     ➖      |      ✅      |      ➖       |       ✅        | ✅ assigned |          ➖           |       ➖       |
| Move pipeline / tasks / calls / site visits               |     ➖      |      ✅      |      ➖       |       ✅        | ✅ assigned |          ➖           | 🟡 read visits |
| Manage projects / inventory / knowledge                   |     ➖      |      ✅      |    🟡 read    |     🟡 read     |   🟡 read   |          ✅           |    🟡 read     |
| Edit scoring rules                                        |     ➖      |      ✅      |      ✅       |       ✅        |     ➖      |          ➖           |       ➖       |
| **Approve/publish** scoring                               |     ➖      |      ✅      |      ➖       |       ✅        |     ➖      |          ➖           |       ➖       |
| Analytics dashboards                                      | 🟡 platform |      ✅      |    🟡 mktg    | ✅ sales/agents |   🟡 own    |          ➖           |    ✅ read     |
| Billing                                                   |     ➖      |      ✅      |      ➖       |       ➖        |     ➖      |          ➖           |    🟡 read     |
| Any mutation (viewer check)                               |      —      |      —       |       —       |        —        |      —      |           —           |  **➖ none**   |

Key invariants **verified by unit + DB tests**: Project Data & Maintenance has **no** `conversations.read.private`; Sales Agent is **assigned-only** (no `leads.read.all`); Viewer holds **no** mutation permission; Super Admin holds **no** tenant-data permission by default.

---

## 8. Security findings

| ID  | Severity | Finding                                                                                                                                                                                                           | Status                                                                                                                                                                                                                     |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **High** | Env validation passed the whole `process.env` object, defeating Next's `NEXT_PUBLIC_*` static inlining → the Edge middleware threw "Invalid client environment" and the app returned **HTTP 500 on every route**. | **Fixed during audit** — `packages/config/src/env.ts` now reads public vars via literal property references; rebuilt and re-verified (`/sign-in` 200, protected routes 307). Also clarified env files live in `apps/web/`. |
| F2  | Low      | `pnpm format:check` failed (lockfile + docs + 2 config files).                                                                                                                                                    | **Fixed** — added `.prettierignore` (excludes `pnpm-lock.yaml`) + `prettier --write`.                                                                                                                                      |
| F3  | Medium   | No application-level audit logging (`audit_logs` / `security_events`) for security-sensitive operations (tenant switch via service-role `updateUserById`, future role changes/impersonation).                     | **Open (debt)** — implement before impersonation/role-edit features land (recommended early Phase 2).                                                                                                                      |
| F6  | Low      | ESLint is not wired with the Next.js plugin (`eslint-config-next`), so Next-specific lint rules don't run during build (`next build` emits a warning).                                                            | Open (debt).                                                                                                                                                                                                               |
| —   | Info     | Service-role key correctly server-only (`admin.ts` has `import 'server-only'`; used only in a Server Action). Not present in client bundle.                                                                       | ✅                                                                                                                                                                                                                         |
| —   | Info     | Auth is genuinely Supabase-backed; tenant resolution + permission checks are server-enforced; RLS is the backstop.                                                                                                | ✅                                                                                                                                                                                                                         |

No secret leakage, no client-only authorization, no hardcoded credentials in source were found.

---

## 9. Accessibility findings

- Sign-in form: labelled inputs, `role="alert"` on error, `autoComplete` set — good baseline.
- Icons marked `aria-hidden`; nav has `aria-label="Primary"`; tenant `select` has `aria-label`.
- **Not yet verified:** automated axe/keyboard/contrast sweep (Playwright + axe is a later-phase deliverable per [`TEST_PLAN.md`](./TEST_PLAN.md) §6). No accessibility regressions observed by inspection, but this was **not** machine-verified in Phase 1.

## 10. Responsive-design findings

- Desktop shell: collapsible-ready sidebar (`hidden w-60 … md:flex`), responsive topbar (tenant switcher, sign-out collapse at `sm`). ✅
- **Gap:** no mobile bottom navigation (`Today / Inbox / Leads / Visits / More` per [`UI_SYSTEM.md`](./UI_SYSTEM.md) §5). On a narrow viewport the sidebar is hidden and no alternative primary nav is presented. Tracked as debt; acceptable for a foundation shell with only 3 pages, must land as more pages ship.
- Sticky mobile lead actions (Call/WhatsApp/etc.) not applicable yet (no lead pages until Phase 3).

## 11. Known limitations (environment)

- Supabase CLI, Docker and system Postgres are unavailable in the audit sandbox; `supabase start` / `supabase db reset` / `supabase test db` were **not** run. Verified via an embedded-Postgres equivalent (pgvector skipped, `auth` stubbed).
- The connected-folder mount blocks `unlink`; `node_modules` cannot be installed in-place from the agent. Installs/builds were run on a sandbox clone. A stray partial `node_modules/` and `_tmp_*` files left by an earlier install attempt remain in the folder (gitignored) and can be deleted from the host OS.

## 12. Technical debt (carry into Phase 2+)

1. **Audit logging** (`audit_logs`, `security_events`) — implement before impersonation/role-edit (F3).
2. **`loading.tsx` / `error.tsx` route boundaries** for `(app)` segments — add to satisfy the "loading + error state on every page" requirement (F4-class).
3. **Mobile bottom navigation** + PWA manifest — add as more pages ship.
4. **ESLint Next plugin** (`eslint-config-next`) wiring (F6).
5. **Official pgTAP run** (`supabase test db`) + extend direct per-table isolation assertions.
6. **CI** (GitHub Actions) running the full gate set is not yet created (planned with Phase 2).
7. Env-file location nuance: Next reads `apps/web/.env.local`, not the repo-root env — document in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## 13. Remaining risks

- **R1 cross-tenant leak** — materially reduced: RLS empirically blocks cross-tenant SELECT/INSERT/UPDATE/DELETE. Residual risk until the official pgTAP suite + per-table direct coverage run in CI.
- **R3/R4 (AI grounding / injection)** — not in Phase 1 scope; deferred to Phase 5.
- **Audit-trail gap (F3)** — privileged actions (tenant switch via service role) are currently unlogged at the app level.
- **Mobile UX (F5)** — agents on phones lack primary nav until the bottom-nav lands.

## 14. Deviations from approved architecture

1. **Active-tenant transport.** [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.2 illustrated a `request.tenant_id` GUC. Implementation uses GUC **`app.current_tenant`** (for server/test transactions) **plus** the JWT `app_metadata.active_tenant` claim, because PostgREST cannot set an arbitrary per-request GUC. Functionally equivalent and documented in `0003_auth_context.sql`. Minor, intentional.
2. **Packages not yet created.** `packages/ai`, `packages/integrations`, `packages/analytics` are planned for later phases and are intentionally absent in Phase 1 (not a deviation, scope).
3. No other deviations: dependency direction, secrets-server-only, permission-based authz, one-codepath deployment, and pure-`domain` logic all hold.

## 15. Phase 2 readiness decision

**Decision: GO for Phase 2 (Projects & Inventory).**

Rationale: every executable Phase 1 quality gate is green (install, format, lint, typecheck, unit, build, app-start, protected-route, secret-scan), and the core security property — tenant isolation — is empirically verified against a real database (17/17). The open items (F3 audit logging, loading/error boundaries, mobile nav, official pgTAP run, CI) are **non-blocking debt** that does not gate Projects/Inventory work, with the explicit condition that **audit logging (F3) is implemented before any impersonation or privileged role-edit feature**, and that `supabase test db` is run locally to confirm pgTAP parity before Phase 10 hardening.

Per instruction, **Phase 2 has not been started**; this report is presented for review.
