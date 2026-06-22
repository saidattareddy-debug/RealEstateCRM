# Phase 7B — Live Provider Activation: Go-Live Runbook & Checklist

**Status: NOT ACTIVATED. This is preparation only.** Everything in this repository
remains in the Phase-7A posture: real provider adapters are inert, public webhooks
are disabled, live sends are impossible, and the controlled-MVP safety gates are
frozen. This document is the operator-facing plan for _eventually_ turning on a real
external provider — it describes the prerequisites, the exact sequence, and the
verification gates. **No step here has been executed.**

It complements, and must stay consistent with, [`INTEGRATIONS.md`](./INTEGRATIONS.md),
[`PHASE_7A_AUDIT.md`](./PHASE_7A_AUDIT.md), [`SECURITY.md`](./SECURITY.md),
[`WEBHOOK_SECURITY.md`](./WEBHOOK_SECURITY.md), [`WHATSAPP_POLICY.md`](./WHATSAPP_POLICY.md),
[`DEPLOYMENT.md`](./DEPLOYMENT.md) and [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4.

---

## 1. Why activation cannot happen by configuration alone

Live activation uses a **two-key model**. Both keys must be present; neither alone
can cause an external connection or a customer send.

| Key                 | What it is                                                                                                                                                                           | Where                                           | Default         | Who flips it                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------- | ------------------------------------------------ |
| **Operator key**    | `INTEGRATION_LIVE_PROVIDERS_ENABLED` + all external prerequisites (credentials, verified webhook domain, provider review, paid + compliance approval, sandbox smoke, named approver) | server env + this runbook                       | `false` / unmet | the product owner / operator                     |
| **Engineering key** | `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED` — a compile-time constant that is `false` until the real network adapters are built and reviewed                                              | `packages/domain/src/integration-activation.ts` | `false`         | a separately reviewed Phase-7B implementation PR |

The pure decision engine `evaluateProviderActivation()` (in
`packages/domain/src/integration-activation.ts`) computes `allowed = operationalReady
&& codePathImplemented`. Because the engineering key is `false`, **`allowed` is always
`false` today** — proven by `integration-activation.test.ts`, which asserts no
combination of operator inputs (512 combinations) ever activates. The server adapter
registry (`apps/web/src/lib/integrations/registry.ts`) routes every "live" request
through this decision and therefore always returns the inert stub that throws
`not_enabled_phase_7a`.

This is the safety guarantee, not a limitation to work around: an operator can stage
every prerequisite, but a real send still requires shipping (and reviewing) the
engineering key in code.

---

## 2. Stop-conditions (per `IMPLEMENTATION_PLAN.md` §4)

Activation crosses **every** build stop-condition, so each requires explicit
product-owner action. None can be performed autonomously by the build agent.

- **External credentials** — Meta WhatsApp Business account + verified webhook
  domain; Google OAuth client (Gmail/Calendar); property-portal API access; AI
  provider keys.
- **Paid-service commitment** — enabling paid WhatsApp/AI usage; a paid Supabase /
  queue (PGMQ) tier; any per-message billing.
- **Irreversible / legally sensitive** — provider app-review submission; consent
  wording; data-processing terms; data-retention periods; flipping any safety switch
  in production.

The build agent **will not** enter provider secrets, accept provider terms, submit a
provider review, purchase a tier, or flip a production switch. The operator performs
those steps; this runbook tells them exactly which, in what order.

---

## 3. Credential & environment intake matrix

Collect these before activation. **Secrets are server-only** — never put any of them
in a `NEXT_PUBLIC_*` variable (the production env validator rejects that), never paste
them into chat, and never commit them. The build agent cannot accept or enter these;
the operator sets them directly in the deployment environment (e.g. Vercel project
settings / Supabase secrets).

| Variable                                                  | Provider | Purpose                              | Sensitivity | Notes                                                      |
| --------------------------------------------------------- | -------- | ------------------------------------ | ----------- | ---------------------------------------------------------- |
| `INTEGRATION_LIVE_PROVIDERS_ENABLED`                      | —        | Operator activation flag             | config      | Default `false`; keep `false` under `controlled_mvp`.      |
| `DEPLOYMENT_PROFILE=full`                                 | —        | Allows live providers                | config      | Only after this checklist passes.                          |
| `WHATSAPP_VERIFY_TOKEN`                                   | Meta     | Webhook verification handshake       | secret      | You choose this; must match the value set in the Meta app. |
| `WHATSAPP_ACCESS_TOKEN`                                   | Meta     | Outbound send / Graph API            | **high**    | System-user token; rotate on schedule.                     |
| `GOOGLE_OAUTH_CLIENT_ID`                                  | Google   | Gmail/Calendar OAuth                 | medium      | Client id (not itself a secret, but pair with the secret). |
| `GOOGLE_OAUTH_CLIENT_SECRET`                              | Google   | Gmail/Calendar OAuth                 | **high**    | Server-only.                                               |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | AI       | Live AI provider (if any AI go-live) | **high**    | Optional for channel-only activation.                      |
| `SENTRY_DSN`                                              | Sentry   | Error monitoring                     | low         | Required in production already.                            |
| `SUPABASE_SERVICE_ROLE_KEY`                               | Supabase | Server admin client                  | **high**    | Already required; never client-side.                       |

Per-provider operator artifacts (tracked outside env): verified webhook domain,
approved provider app/business review reference, signed paid-service approval,
compliance/consent sign-off, sandbox smoke result, and the **named approver**.

---

## 4. Pre-activation checklist (operator)

Work top to bottom. Do not start a row until every row above it is checked.

- [ ] **4.1** Hosted staging verification is GO (see [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md) — currently NO-GO pending hosted staging). Live providers must not precede a verified staging baseline.
- [ ] **4.2** Choose **one** provider for the first activation (recommended: WhatsApp Cloud **or** Gmail — not all at once). Narrow surface = reviewable.
- [ ] **4.3** Create the provider account/app; complete the provider's own review/verification (e.g. Meta business + app review).
- [ ] **4.4** Verify the inbound **webhook domain** with the provider; record the reference.
- [ ] **4.5** Obtain and store credentials in the deployment env (Section 3). Confirm none leaked into `NEXT_PUBLIC_*`.
- [ ] **4.6** Record **paid-service approval** (who approved which billable usage, and the cap).
- [ ] **4.7** Record **compliance / privacy / consent-wording sign-off** (DPA, retention period, opt-out language).
- [ ] **4.8** Identify the **named approver** for activation (a person, for audit).
- [ ] **4.9** Engineering: the real adapter for the chosen provider is implemented and code-reviewed (flips `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED` for that path). **This is a code PR, not a config change, and is out of scope for this prep.**

> Until **4.9** ships, `evaluateProviderActivation()` returns `allowed:false` and the
> registry stays inert — by design. Sections 5–7 are the plan for _after_ 4.9 lands.

---

## 5. Activation sequence (after all of Section 4 is met)

1. **Sandbox first.** Run the chosen provider against its sandbox/fixture mode; pass the integration smoke. No production traffic.
2. **Staging, profile=full, flag on, webhooks on** — set `DEPLOYMENT_PROFILE=full`, `INTEGRATION_LIVE_PROVIDERS_ENABLED=true`, `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=true` **in staging only**. Verify the webhook handshake, signature verification, idempotency, and that inbound events route through the existing lead/conversation services.
3. **Shadow / inbound-only** in staging: receive real inbound events; confirm **no** automatic customer send occurs (live-send remains separately gated by `LIVE_SEND_MASTER_SWITCH` / `RESPONDER_LIVE_SENDING`).
4. **Human-send only**, one tenant, rate-limited: enable agent-initiated outbound for a single pilot tenant; verify consent/DNC/WhatsApp-session gates on real traffic.
5. **Production, single tenant**, with the kill switch and monitoring confirmed. Hold here and observe.
6. **Widen** tenant-by-tenant only after a clean observation window.

Each step is reversible by the kill switch (Section 7) and gated by the per-message
checks already enforced in `simulateHumanSend` / the responder gate sequence.

---

## 6. Verification gates at each step

| Gate                                                                  | What it proves                                     |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| Provider webhook handshake + signature                                | Inbound authenticity (`WEBHOOK_SECURITY.md`).      |
| Idempotency (replay a delivered event)                                | No duplicate leads / messages.                     |
| Consent / DNC / WhatsApp session policy                               | No contact without consent / outside session.      |
| Tenant isolation (RLS harness still green)                            | A live tenant cannot read another tenant's events. |
| No secret in client bundle (`pnpm verify:secrets`)                    | Credentials stayed server-side.                    |
| Kill switch halts sends within the documented window                  | Reversibility.                                     |
| Observability (Sentry + integration health) shows the live connection | We can see failures.                               |

Re-run the existing gates before and after each step: `pnpm typecheck`, `pnpm test`,
`pnpm test:web`, the RLS harness, `pnpm verify:secrets`, `pnpm verify:no-external-io`
(note: the no-external-IO scan must be relaxed only for the specifically-activated
adapter, never globally), and `pnpm build`.

---

## 7. Kill switch & rollback

To deactivate immediately, set `INTEGRATION_LIVE_PROVIDERS_ENABLED=false` (operator
key) and/or `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false`; the registry returns to the
inert stub and public webhooks are rejected generically. For a full revert, set
`DEPLOYMENT_PROFILE=controlled_mvp` — the production env validator will then _require_
all live switches to be off. Live AI sending has its own outer switches
(`LIVE_SEND_MASTER_SWITCH`, `RESPONDER_LIVE_SENDING`) which remain `false` independent
of channel activation.

---

## 8. What this prep PR changed (and did not)

**Changed (safe, no credentials, nothing sends):**

- Added the operator key `INTEGRATION_LIVE_PROVIDERS_ENABLED` (server env, default
  `false`) + `liveProviderActivationEnabled()` helper; the production validator now
  rejects it being `true` under `controlled_mvp`.
- Added the pure decision engine `packages/domain/src/integration-activation.ts`
  (`evaluateProviderActivation`, `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED=false`,
  blocker labels) + exhaustive tests proving nothing activates.
- Gated the adapter registry with `resolveActivationAdapter()` — always returns the
  inert stub today, returns the structured decision for observability.
- This runbook + the credential/env intake matrix + `.env.example` documentation.

**Did NOT change:** no real network adapter, no migration, no safety-switch flip, no
credentials, no provider account, no public-webhook enablement, no live send. The
Phase-7A harness and all safety guarantees are untouched.
