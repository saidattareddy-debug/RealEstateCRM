# Phase 5B.1 — Controlled Live-Send Activation: Go-Live Runbook & Sign-off Ledger

**Status: NOT ACTIVATED. Preparation only.** Automatic AI replies to real customers
remain **impossible by construction**. The compile-time `LIVE_SEND_MASTER_SWITCH`
(`packages/domain/src/ai-live-send.ts`) is `false`; the per-message gate
(`evaluateLiveSendGates`) and the new activation-governance engine
(`evaluateLiveActivation`) both AND against it, so no database state, approval, or
configuration can produce a customer send. This document is the operator-facing plan
to _eventually_ flip that switch. **No step here has been executed.**

Complements [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md),
[`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md),
[`AI_ROLLOUT_PLAN.md`](./AI_ROLLOUT_PLAN.md),
[`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md),
[`AI_DELIVERY_LIFECYCLE.md`](./AI_DELIVERY_LIFECYCLE.md), and
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4.

---

## 1. Two-key model

Activation requires two independent keys; neither alone can send.

| Key                 | What it is                                                                                                                                                                              | Where                                 | Default | Who flips it                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------- | ----------------------------------------- |
| **Operator key**    | A fully-approved activation request (Product + Engineering + Legal sign-off, no rejection, requester ≠ approver), a non-sendable mode, kill switch off, and a configured rollout window | `responder_*` tables + this runbook   | unmet   | the product owner via two-person workflow |
| **Engineering key** | `LIVE_SEND_MASTER_SWITCH` — a compile-time `false`                                                                                                                                      | `packages/domain/src/ai-live-send.ts` | `false` | a separately reviewed 5B.1 release PR     |

The governance engine `evaluateLiveActivation()` returns `liveSendingPermitted =
operatorReady && masterSwitchOn`. Because the master switch is `false`,
`liveSendingPermitted` is **always false** today — proven by
`ai-live-activation.test.ts` across all 192 operator-input combinations. The strongest
mode the activation service will ever persist is `live_candidate`, which the
per-message gate still suppresses.

---

## 2. What this prep PR added (and did not)

**Added (no credentials, nothing sends):**

- **Governance engine** `packages/domain/src/ai-live-activation.ts`
  (`evaluateLiveActivation`, `evaluateApprovalCompleteness`, `isApplicableMode`,
  `SENDABLE_MODES`, blocker labels) + exhaustive tests.
- **Activation service** `apps/web/src/lib/responder/activation.ts` driving the
  Phase-5B.0 tables: request, multi-role approval, apply-approved-mode (clamped to a
  non-sendable mode), kill switch — permission-gated + audited.
- **Server actions** `…/settings/ai/activation/actions.ts` and a **permission-gated
  UI** `…/settings/ai/activation/page.tsx` with a prominent "automatic sending is OFF"
  banner, the sign-off ledger, request/approve/apply controls, and the kill switch.
- **Tests**: `responder-activation.web.test.ts` (service + safety) and the domain
  suite; the in-memory fake gained `is`/`order`/`limit` support.

**Did NOT change:** no migration (the 0020 tables suffice), no switch flip, no
provider credentials, no real delivery path, no widening of the `ai_runs` /
`ai_responder_decisions` / `send_candidate_status` CHECK constraints. The RLS harness
is unchanged.

---

## 3. Stop-conditions (per `IMPLEMENTATION_PLAN.md` §4)

Flipping the switch crosses **every** stop-condition; each is the product owner's to
perform. The build agent will not flip the switch, enter credentials, accept terms, or
commit to paid usage.

- **External credentials** — server-only AI provider keys; a real delivery channel
  (WhatsApp/email, itself gated behind Phase 7B); live Supabase + the pgvector ANN path.
- **Paid-service commitment** — paid AI usage; a production PGMQ/queue tier.
- **Irreversible / legally sensitive** — the master-switch flip; consent wording;
  data-processing terms; the two-person activation sign-off.

---

## 4. Pre-activation checklist (operator)

Top to bottom; do not start a row until every row above is checked.

- [ ] **4.1** Hosted staging verification is GO (see [`CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./CONTROLLED_MVP_DEPLOYMENT_AUDIT.md) — currently NO-GO).
- [ ] **4.2** Phase 7B live channel is activated for the chosen channel (WhatsApp/email need a real provider; see [`PHASE_7B_GO_LIVE.md`](./PHASE_7B_GO_LIVE.md)). Website-chat needs no external provider.
- [ ] **4.3** AI provider credentials are wired server-side; the model + knowledge are approved; grounding passes evaluation.
- [ ] **4.4** A rollout window is configured on the channel (`rollout_percentage > 0`, `effective_start` set).
- [ ] **4.5** An activation request is raised for the channel at `live_candidate`.
- [ ] **4.6** **Two-person sign-off** recorded — Product, Engineering, Legal each approve; the requester does not approve their own request (DB-enforced).
- [ ] **4.7** Kill switch verified working (activate → responder stands down → clear).
- [ ] **4.8** Engineering: the master switch is flipped in a reviewed release PR (widening the relevant CHECKs + wiring an idempotent PGMQ delivery worker). **Out of scope for this prep.**

> Until **4.8** ships, `evaluateLiveActivation` returns `liveSendingPermitted:false`
> and the service persists at most `live_candidate` — by design.

---

## 5. Sign-off ledger (fill at activation time)

| Role                            | Approver (name) | Decision             | Date     | Reference |
| ------------------------------- | --------------- | -------------------- | -------- | --------- |
| Product                         | \***\*\_\*\***  | ☐ approve / ☐ reject | **\_\_** | **\_\_**  |
| Engineering                     | \***\*\_\*\***  | ☐ approve / ☐ reject | **\_\_** | **\_\_**  |
| Legal                           | \***\*\_\*\***  | ☐ approve / ☐ reject | **\_\_** | **\_\_**  |
| **Requester** (may NOT approve) | \***\*\_\*\***  | n/a                  | **\_\_** | **\_\_**  |

Recorded in `responder_activation_approvals` (unique per approver; requester-self-approval blocked by trigger).

---

## 6. Staged rollout (after 4.8)

1. **Shadow** — decisions logged, nothing sent. Soak.
2. **Copilot** — drafts offered to agents; agent sends manually.
3. **Live candidate** — candidates produced + revalidated, still suppressed; confirms the full path without delivery.
4. **Live, single tenant, low rollout %** — first real sends, kill switch + monitoring confirmed. Hold.
5. **Widen** tenant-by-tenant after a clean observation window.

Every step is reversible by the kill switch (Section 7) and re-checked at worker time
by `revalidateAutomaticSend` (never proceeds while the master switch is off).

---

## 7. Kill switch & rollback

Per channel, set `kill_switch_active = true` (the UI's kill-switch control, audited as
`responder.killswitch.activated`) to stand the responder down immediately. To fully
revert an activation, set the channel `mode` back to `disabled`. The master switch is
the outermost stop: while it is `false`, sending is impossible regardless of channel
state.

---

## 8. Verification gates (each step)

| Gate                                                              | Proves                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `ai-live-activation.test.ts` / `responder-activation.web.test.ts` | Governance never permits sending; two-person integrity.       |
| RLS harness                                                       | A tenant cannot read/modify another tenant's activation rows. |
| `pnpm verify:secrets`                                             | No provider secret in client bundles.                         |
| Kill-switch drill                                                 | Reversibility within the documented window.                   |
| Observability (Sentry + responder metrics)                        | Failures are visible.                                         |

Re-run `pnpm typecheck`, `pnpm test`, `pnpm test:web`, the RLS harness,
`pnpm verify:secrets`, `pnpm verify:no-external-io`, and `pnpm build` before and after
each step.
