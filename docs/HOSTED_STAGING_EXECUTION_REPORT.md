# Hosted Staging — Execution & Evidence Report

**Status while incomplete:**

```
Core Product Phases 0–10 — Locally Complete and Verified
Controlled-MVP Production — NO-GO Pending Hosted Staging
Phase 7B Live Providers — Not Activated
Phase 5B.1 Automatic Live Send — Not Activated
Automatic Customer Sending — Impossible
```

This is the live evidence log for the hosted-staging verification pass. It is the
companion to [`HOSTED_STAGING_RUNBOOK.md`](./HOSTED_STAGING_RUNBOOK.md) (the
procedure) and [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md)
(the go/no-go).

## Division of labour (read first)

The hosted steps must be executed **by the operator** against the live Vercel
deployment + hosted Supabase, because they require the deploy context, the
service-role key / database URL, a real browser, and the cloud console. The build
agent **cannot** run them (it will not handle secrets, has no browser, and has no
network path to your hosted project). The agent's role is: provide the exact
reviewed commands, attest everything verifiable in the repository, and keep this
report + the go/no-go honest. **No hosted result in this report may be invented** —
every operator-run field stays `PENDING` until you paste the real output.

Legend: ✅ VERIFIED (repo, by agent) · ⏳ PENDING (operator must run/paste) ·
⛔ BLOCKER.

### Safety invariants to preserve in the deploy env (do not change)

```
DEPLOYMENT_PROFILE=controlled_mvp
INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false
INTEGRATION_LIVE_PROVIDERS_ENABLED=false
LIVE_SEND_MASTER_SWITCH=false
RESPONDER_LIVE_SENDING=false
```

The Anthropic key is permitted **only** for `/ai/test-lab`, shadow, and copilot
generation. It must remain server-only. Never paste any secret into chat or commit
it.

---

## Repo-side prerequisites (agent-verified)

| Item                                        | Status | Evidence                                                                                                           |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Migrations 0001–0030 present, no gaps       | ✅     | `ls supabase/migrations/*.sql` = 30                                                                                |
| Preflight scripts exist                     | ✅     | `pnpm db:staging:preflight` / `db:production:preflight` → `scripts/db-preflight.mjs`                               |
| Hosted RLS runner exists                    | ✅     | `pnpm hosted:rls` → `scripts/hosted-rls-verification.mjs` (refuses prod; `STAGING_ONLY_ACK`)                       |
| Demo seed/status/reset exist                | ✅     | `pnpm demo:seed/status/reset` → `scripts/demo-*.mjs` (hard safety gate)                                            |
| Perf baseline exists                        | ✅     | `pnpm perf:baseline` → `scripts/staging-performance-baseline.mjs`                                                  |
| Smoke test (≥35 steps)                      | ✅     | `docs/CONTROLLED_MVP_SMOKE_TEST.md` (37 numbered rows)                                                             |
| Backup/restore drill runbook                | ✅     | `docs/BACKUP_RESTORE_DRILL.md`                                                                                     |
| Safety flags default to safe values in code | ✅     | `packages/config/src/env.ts` (all gates default `false`; prod validator rejects them under `controlled_mvp`)       |
| Local gates green                           | ✅     | typecheck · 413 unit · 56 web · RLS harness 349/349 + pg-phase8 9/9 + pg-phase9 6/6 · secret-scan · no-external-IO |

---

## 1. Environment identity

Record from the Vercel + Supabase dashboards (no secrets):

| Field                                           | Value                              | Status |
| ----------------------------------------------- | ---------------------------------- | ------ |
| Vercel project name                             | `__________`                       | ⏳     |
| Vercel environment (Production used as staging) | `__________`                       | ⏳     |
| Deployment URL                                  | `https://__________`               | ⏳     |
| Git commit SHA                                  | `__________`                       | ⏳     |
| Supabase project ref                            | `zdlmgphujafhsbwplqrm` (confirm)   | ⏳     |
| Database environment                            | staging (single project; see note) | ⏳     |
| Migration range applied (hosted)                | `__________` (expect 0001–0030)    | ⏳     |
| `DEPLOYMENT_PROFILE`                            | `controlled_mvp` (confirm)         | ⏳     |
| `APP_ENV`                                       | `staging` recommended (see note)   | ⏳     |

> **Note (single Supabase project):** there is one Supabase project
> (`zdlmgphujafhsbwplqrm`) serving as staging per the directive ("use the current
> Vercel deployment as a staging environment only"). Confirm it is **not** also a
> live production project and shares no production credentials — otherwise **⛔ STOP**.
> **Note (`APP_ENV`):** if `APP_ENV=production` the env validator additionally
> requires `SENTRY_DSN` + `SESSION_SIGNING_SECRET` or the app fails to boot
> (`packages/config/src/env.ts`). For staging use `APP_ENV=staging`.

**⛔ STOP CONDITION:** if the deployment points at a production Supabase project or
shares production credentials, halt and do not proceed.

---

## 2. Staging preflight

Run from the repo with the deploy's public values (no secrets needed):

```bash
EXPECTED_SUPABASE_PROJECT_REF=zdlmgphujafhsbwplqrm \
NEXT_PUBLIC_SUPABASE_URL=https://zdlmgphujafhsbwplqrm.supabase.co \
DEPLOYMENT_PROFILE=controlled_mvp \
pnpm db:staging:preflight
```

Then verify the **hosted** migration state with the Supabase CLI (the preflight
prints these; it does not connect to the DB itself):

```bash
supabase link --project-ref zdlmgphujafhsbwplqrm   # safe
supabase migration list                            # compare local vs remote
```

| Check                                      | Expected               | Actual | Status |
| ------------------------------------------ | ---------------------- | ------ | ------ |
| Correct staging project ref                | `zdlmgphujafhsbwplqrm` | `____` | ⏳     |
| Migrations 0001–0030 present (remote)      | all 30                 | `____` | ⏳     |
| No gaps / no modified historical checksums | none                   | `____` | ⏳     |
| Public webhooks disabled                   | `false`                | `____` | ⏳     |
| Live providers disabled                    | `false`                | `____` | ⏳     |
| Live-send switches disabled                | `false`                | `____` | ⏳     |
| Binary media disabled                      | `false`                | `____` | ⏳     |

**Agent-run repo-side sample (read-only, public ref/URL only — no secrets):**

```
=== DB preflight (staging) — READ-ONLY, no changes applied ===
  • migrations: 30 files, range 0001-0030
  • supabase project ref: zdlmgphujafhsbwplqrm

PREFLIGHT FAILED:
  ✗ missing required env: NEXT_PUBLIC_SUPABASE_ANON_KEY
  ✗ missing required env: SUPABASE_SERVICE_ROLE_KEY
  ✗ missing required env: NEXT_PUBLIC_APP_URL
```

This confirms (repo-side): the script is read-only, sees **30 migrations
(0001–0030)**, matches the project ref, and refuses to proceed until the deploy env
is complete. The operator must re-run it in the deploy shell (env populated) and
additionally run `supabase migration list` to compare against the **hosted** DB.

Paste the full `preflight` (env-complete) + `supabase migration list` output below:

```
PENDING — operator output (hosted)
```

---

## 3. Apply migrations (forward-only)

**Reviewed command — forward-only, never reset:**

```bash
supabase db push        # applies pending migrations 0001–0030 forward-only
# DO NOT run `supabase db reset` against staging.
```

After application, verify (SQL or dashboard):

| Check                                     | How                                                                                                                                                                                                                                                                                                                 | Status |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Migration level = 0030                    | `supabase migration list`                                                                                                                                                                                                                                                                                           | ⏳     |
| Functions present                         | `current_tenant_id`, `has_permission`, `effective_permissions`, `on_tenant_created`, `grant_phase8_perms`, `grant_phase9_perms`, …                                                                                                                                                                                  | ⏳     |
| Triggers present                          | `on_tenant_created` (+ phase triggers)                                                                                                                                                                                                                                                                              | ⏳     |
| RLS enabled on all tenant tables          | `select relname,relrowsecurity from pg_class where relkind='r'`                                                                                                                                                                                                                                                     | ⏳     |
| Provisioning hook complete                | new-tenant test seeds branding/roles/pipeline/scoring/matching/integration (regression fixed in 0029/0030)                                                                                                                                                                                                          | ⏳     |
| pgvector available OR fallback documented | `select * from pg_extension where extname='vector'` (else in-SQL cosine fallback)                                                                                                                                                                                                                                   | ⏳     |
| Phase 8 tables exist                      | `automations, automation_actions, automation_runs, automation_run_actions, followup_sequences, followup_steps, followup_enrollments, followup_step_events, site_visits, visit_events, visit_outcomes, calendar_connections, calendar_busy_blocks, notifications, notification_preferences, notification_deliveries` | ⏳     |
| Phase 9 tables exist                      | `usage_counters, billing_periods, system_health_checks, analytics_export_logs`                                                                                                                                                                                                                                      | ⏳     |

```
PENDING — operator output
```

---

## 4. Seed staging demo data

```bash
ALLOW_DEMO_DATA_SEED=true \
DEPLOYMENT_PROFILE=controlled_mvp \
DEMO_SEED_CONFIRMATION=I_UNDERSTAND_THIS_CREATES_SYNTHETIC_DATA \
NEXT_PUBLIC_SUPABASE_URL=https://zdlmgphujafhsbwplqrm.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<paste in your shell only> \
pnpm demo:seed --tenant northwind --dry-run     # preview, writes nothing

# then, if the dry-run looks right, swap --dry-run for --confirm:
… pnpm demo:seed --tenant northwind --confirm
… pnpm demo:status --tenant northwind
```

> **Tenant slug:** the seeded tenant is `northwind` (the generator resolves by
> tenant id and accepts `northwind` or `northwind-estates`).

Record exact counts from `demo:status` (Expected = the generator's dataset; Actual =
operator output). **Automations / Visits / Analytics records are NOT seeded by the
demo generator** (it predates Phase 8/9) — expect 0 unless created separately;
recorded here for completeness.

| Entity                                | Expected                      | Actual | Status |
| ------------------------------------- | ----------------------------- | ------ | ------ |
| Projects                              | 3                             | `__`   | ⏳     |
| Configurations                        | 8                             | `__`   | ⏳     |
| Inventory units                       | 48                            | `__`   | ⏳     |
| Leads                                 | 40                            | `__`   | ⏳     |
| Tasks                                 | 25                            | `__`   | ⏳     |
| Conversations                         | 15                            | `__`   | ⏳     |
| Messages                              | 51                            | `__`   | ⏳     |
| Knowledge documents                   | 10                            | `__`   | ⏳     |
| Knowledge chunks                      | 46                            | `__`   | ⏳     |
| Mock embeddings                       | 46                            | `__`   | ⏳     |
| Score runs                            | 40                            | `__`   | ⏳     |
| Match runs                            | 12                            | `__`   | ⏳     |
| Automations                           | 0 (not seeded)                | `__`   | ⏳     |
| Visits                                | 0 (not seeded)                | `__`   | ⏳     |
| Analytics records                     | 0 (computed live; not seeded) | `__`   | ⏳     |
| **Idempotency: 2nd seed adds 0 rows** | counts unchanged              | `__`   | ⏳     |

```
PENDING — operator output (dry-run + confirm + status, ×2 for idempotency)
```

---

## 5. Verify Anthropic safely (AI test-lab only)

Confirm via metadata only — never print the key, authorization header, or full
provider request.

| Field                                                 | Value                                                             | Status |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Anthropic key server-only (absent from client bundle) | `secret-scan` clean (repo ✅); confirm not in any `NEXT_PUBLIC_*` | ⏳     |
| Provider / model (metadata)                           | `__________`                                                      | ⏳     |
| `/ai/test-lab` run created                            | yes                                                               | ⏳     |
| Provider selected                                     | `__________`                                                      | ⏳     |
| Retrieval event recorded                              | yes                                                               | ⏳     |
| Retrieved sources (Approved only)                     | `__________`                                                      | ⏳     |
| Grounding outcome                                     | `grounded` / `escalate`                                           | ⏳     |
| Citations present                                     | yes                                                               | ⏳     |
| Latency                                               | `__ ms`                                                           | ⏳     |
| Token usage (if available)                            | `__`                                                              | ⏳     |
| **No outbound conversation message created**          | confirmed                                                         | ⏳     |
| **No delivered status**                               | confirmed                                                         | ⏳     |
| **No automatic send**                                 | confirmed (master switch off)                                     | ⏳     |

```
PENDING — operator output
```

---

## 6. Hosted RLS

```bash
STAGING_ONLY_ACK=yes \
EXPECTED_ENV=staging \
STAGING_DATABASE_URL='postgres://…(staging, your shell only)…' \
pnpm hosted:rls
```

Records JSON + Markdown reports. Verify every role; **any cross-tenant visibility or
silent platform-admin tenant access ⇒ ⛔ NO-GO.**

| Role                                           | Cross-tenant denied | Own-tenant scoped | Status |
| ---------------------------------------------- | ------------------- | ----------------- | ------ |
| Client Admin                                   |                     |                   | ⏳     |
| Sales Manager                                  |                     |                   | ⏳     |
| Sales Agent (assigned-scope)                   |                     |                   | ⏳     |
| Marketing Manager (metadata-only)              |                     |                   | ⏳     |
| Project Maintenance                            |                     |                   | ⏳     |
| Viewer                                         |                     |                   | ⏳     |
| Platform Administrator (no silent tenant data) |                     |                   | ⏳     |

```
PENDING — operator JSON + Markdown report
```

---

## 7. Browser smoke (35+ steps)

Execute **all** steps in [`CONTROLLED_MVP_SMOKE_TEST.md`](./CONTROLLED_MVP_SMOKE_TEST.md)
against the deployed URL, desktop **and** mobile.

- Tester: `__________` · Date/time: `__________` · Build SHA: `__________`

| #    | Step        | Expected | Actual | Pass/Fail | Evidence | Defect |
| ---- | ----------- | -------- | ------ | --------- | -------- | ------ |
| 1–37 | see runbook |          |        | ⏳        |          |        |

```
PENDING — operator results table + screenshots (desktop + mobile)
```

---

## 8. Phase 8 & 9 safety (on hosted)

| Check                                        | Expected                                                 | Status |
| -------------------------------------------- | -------------------------------------------------------- | ------ |
| Automations execute allowed internal actions | task/stage/assign/tag/note happen                        | ⏳     |
| Automation customer-send actions             | `will_send=false`, `status='suppressed'`                 | ⏳     |
| Follow-up delivery suppressed                | step events `will_send=false`                            | ⏳     |
| Calendar connection simulation-only          | status ∈ {disconnected, simulated}; never connected      | ⏳     |
| External notifications simulated             | `notification_deliveries.simulated=true` for email/push  | ⏳     |
| Analytics use real visible data              | funnel/source/team from real rows under RLS              | ⏳     |
| Unknown spend stays null                     | `costPerLead/costPerWon = null` when spend absent        | ⏳     |
| Exports logged                               | `analytics_export_logs` row + `analytics.exported` audit | ⏳     |
| Role visibility correct                      | per-permission gating holds                              | ⏳     |

```
PENDING — operator output
```

---

## 9. Observability

| Check                                               | Expected                                                              | Status |
| --------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| Sentry receives a synthetic application error       | error visible in Sentry                                               | ⏳     |
| Structured logs carry correlation IDs               | present                                                               | ⏳     |
| `/api/health` monitored                             | 200 + profile/switch flags; uptime monitor watching it                | ⏳     |
| Uptime monitor active                               | configured                                                            | ⏳     |
| Database errors visible                             | surfaced                                                              | ⏳     |
| Redaction removes secrets + customer message bodies | confirmed (repo: `packages/validation/redaction.ts`, audit redaction) | ⏳     |

```
PENDING — operator output
```

---

## 10. Backup & restore drill

Follow [`BACKUP_RESTORE_DRILL.md`](./BACKUP_RESTORE_DRILL.md). Restore staging into a
**disposable** recovery project — **never** over active staging.

| Check                         | Expected              | Actual | Status |
| ----------------------------- | --------------------- | ------ | ------ |
| Migration level after restore | 0030                  | `__`   | ⏳     |
| Row counts match              | within drift window   | `__`   | ⏳     |
| Tenant isolation intact       | RLS holds in recovery | `__`   | ⏳     |
| Auth configuration restored   | yes                   | `__`   | ⏳     |
| Core smoke subset passes      | yes                   | `__`   | ⏳     |
| Recovery time (RTO)           | `__ min`              | `__`   | ⏳     |

```
PENDING — operator output
```

---

## 11. Performance baseline

```bash
STAGING_ONLY_ACK=yes \
STAGING_BASE_URL=https://<deploy-url> \
STAGING_SESSION_COOKIE='<auth cookie, your shell only>' \
pnpm perf:baseline
```

Record median / P95 / error-rate per route (writes
`docs/PERFORMANCE_BASELINE.result.json`):

| Route        | Median | P95 | Error rate | Status |
| ------------ | ------ | --- | ---------- | ------ |
| Dashboard    |        |     |            | ⏳     |
| Leads        |        |     |            | ⏳     |
| Pipeline     |        |     |            | ⏳     |
| Tasks        |        |     |            | ⏳     |
| Inbox        |        |     |            | ⏳     |
| Projects     |        |     |            | ⏳     |
| Inventory    |        |     |            | ⏳     |
| Automations  |        |     |            | ⏳     |
| Visits       |        |     |            | ⏳     |
| Analytics    |        |     |            | ⏳     |
| Website chat |        |     |            | ⏳     |
| AI test lab  |        |     |            | ⏳     |

```
PENDING — operator output + slow-endpoint notes
```

---

## 12. Final report & sign-off

The go/no-go in [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md)
stays **NO-GO** until sections 1–11 are all ✅ with pasted evidence and the
approvals below are named.

| Role                               | Name     | Decision             | Date   |
| ---------------------------------- | -------- | -------------------- | ------ |
| Technical approver                 | `______` | ☐ approve / ☐ reject | `____` |
| Product approver                   | `______` | ☐ approve / ☐ reject | `____` |
| Operations owner                   | `______` | ☐ approve / ☐ reject | `____` |
| Security / privacy acknowledgement | `______` | ☐ ack                | `____` |

**Only after every hosted requirement passes** may the status become:

```
Controlled-MVP Production — APPROVED
Core Product Phases 0–10 — Verified
Phase 7B Live Providers — Not Activated
Phase 5B.1 Automatic Live Send — Not Activated
Automatic Customer Sending — Impossible
```

Until then the NO-GO block at the top of this file and in the deployment audit
stands.
