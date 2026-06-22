# Security Review (Phase 10)

A consolidated security review of the platform at the end of the phased build.
Complements [`SECURITY.md`](./SECURITY.md) (the design) — this file is the
end-of-build verification with evidence. No new finding blocks the controlled-MVP
posture; the residual items are the documented external stop-conditions.

## 1. Tenant isolation (RLS)

- Every tenant-owned table has `tenant_id` and **default-deny** RLS; the server
  re-checks `(tenant, permission)`. Client-supplied `tenant_id` is never trusted.
- **Evidence:** the embedded-Postgres harness (`supabase/tests/local-harness/run.mjs`)
  asserts **349/349** across migrations 0001–0030 — per-table RLS enablement,
  cross-tenant SELECT/INSERT/UPDATE/DELETE denial, role-permission matrices, and
  the safety CHECKs. Phase 8/9 tables are additionally covered by `pg-phase8`
  (9/9) and `pg-phase9` (6/6).
- Platform-admin has **no silent** tenant-data access (removed in Phase 1.1);
  it sees only the tenants registry + platform-scope rows.

## 2. Secrets

- Only the Supabase **anon** key is public. The service-role key, session-signing
  secret, and any provider secret are server-only.
- Provider credentials are referenced by **env-var name** (`secret_ref`), never
  stored as plaintext.
- **Evidence:** `pnpm verify:secrets` (expanded scan: Meta/Google/OpenAI/Slack/
  private-key/Bearer patterns) is clean; the production env validator rejects a
  secret leaked through any `NEXT_PUBLIC_*` var and fails startup on incomplete
  prod config (`packages/config/src/env.ts`).

## 3. Authorization

- Authorization is against **granular permission keys** (not role names);
  `effective_permissions` unions role + user-permission overrides under RLS.
- The dashboard, automations, analytics, billing, and admin surfaces are each
  `ensurePermission`-gated server-side; RLS is the backstop.

## 4. External surfaces

- Public provider webhooks are **disabled by default**
  (`INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false`); when enabled they verify HMAC,
  enforce replay windows + size caps + rate limits, and persist-before-process with
  DB idempotency. Tenant/integration is resolved from the endpoint, never the
  payload.
- Public form/chat endpoints are origin-allow-listed, rate-limited, honeypotted,
  consent-gated, and non-disclosing (never reveal whether a contact exists; no
  tenant-id / DB-error leakage).
- **No external network IO** anywhere in the integration/automation/analytics
  surface — `pnpm verify:no-external-io` (static + runtime trap) is clean.

## 5. AI / automation safety

- The four safety switches are frozen: `LIVE_SEND_MASTER_SWITCH=false`,
  `RESPONDER_LIVE_SENDING=false`, public webhooks off, live-provider activation off.
- Automatic customer sending is **impossible by construction** at three layers
  (compile-time constant, DB CHECKs forbidding a delivered/sent state, suppressing
  services). Phase 8 automations/follow-ups carry `will_send=false` CHECKs.
- Uploaded docs / website text are treated as **untrusted** (prompt-injection):
  reference-only, never instructions. AI structured outputs are Zod-validated.
- Consent/DNC + WhatsApp session/template rules are enforced before any (simulated)
  outbound.

## 6. Auditing & PII

- Append-only `audit_logs` + `security_events` with a typed catalogue; secret
  redaction on write; data-egress (exports) are logged (`analytics.exported`,
  category `data_export`). PII is masked by permission; log redaction helpers exist.

## 7. Residual / external (documented stop-conditions)

Live provider credentials, paid-service approval, the master-switch flip, live
calendar/email/push delivery, and hosted-staging verification (provisioning,
backup/restore drill, hosted RLS, browser smoke, observability, perf baseline) are
**out of scope** for the local build and tracked in `TECH_DEBT.md`,
`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`, `PHASE_7B_GO_LIVE.md`, and
`PHASE_5B1_GO_LIVE.md`. The controlled-MVP go/no-go remains **NO-GO pending hosted
staging** by design.
