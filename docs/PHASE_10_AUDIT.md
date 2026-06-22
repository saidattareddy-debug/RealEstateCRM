# Phase 10 Audit — Hardening

End-of-build hardening: a full RLS sweep, a consolidated security review, an
accessibility pass, performance notes, monitoring confirmation, deployment-runbook
completion, and the §35 Definition-of-Done mapping. Status: **all locally-verifiable
acceptance criteria met**; production go/no-go remains **NO-GO pending hosted
staging** by design.

## What was done

| Area                     | Result                                | Evidence                                                                      |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------- |
| Full RLS test sweep      | ✅ 349/349 + 9/9 + 6/6                | `run.mjs` (0001–0030), `pg-phase8`, `pg-phase9`                               |
| Security review          | ✅                                    | [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md)                                  |
| Accessibility pass       | ✅ (automated browser sweep deferred) | [`ACCESSIBILITY.md`](./ACCESSIBILITY.md)                                      |
| Performance              | ✅ practices; load test deferred      | [`PERFORMANCE.md`](./PERFORMANCE.md) + `PERFORMANCE_BASELINE.md`              |
| Monitoring               | ✅                                    | `/api/health`; prod requires `SENTRY_DSN`; log-redaction helpers              |
| Deployment runbook       | ✅                                    | `DEPLOYMENT.md` + `HOSTED_STAGING_RUNBOOK.md` + env matrix + go-live runbooks |
| Definition of Done (§35) | ✅ 30/30 local                        | [`DEFINITION_OF_DONE.md`](./DEFINITION_OF_DONE.md)                            |

## Regression caught + fixed during hardening

The full RLS sweep surfaced a real regression introduced when migrations 0029/0030
rewrote `on_tenant_created()`: the rewrite was based on the pre-6A version and
**dropped the 6A scoring / 6B matching / 7A integration / demo provisioning calls**,
so a newly-created tenant would not have been seeded with a scoring model, matching
model, or integration connection. Both 0029 and 0030 were corrected to call the full
provisioning chain; the harness returned to **349/349**. (This is exactly why the
sweep is part of hardening.)

## Gates (final)

format ✅ · lint 0-err ✅ · typecheck ✅ (all 5 projects) · **413 unit** ✅ · **56 web** ✅ ·
**RLS harness 349/349** ✅ + **pg-phase8 9/9** + **pg-phase9 6/6** ✅ (migrations
0001–0030 + seed) · secret-scan ✅ · no-external-IO ✅ · all four safety switches
frozen.

## Residual (documented external stop-conditions)

Hosted-staging execution (provisioning, backup/restore drill, hosted RLS, browser
smoke, observability wiring, perf baseline), live provider activation (7B), and the
live-send master switch (5B.1). Tracked in `CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`,
`PHASE_7B_GO_LIVE.md`, `PHASE_5B1_GO_LIVE.md`, and `TECH_DEBT.md`.
