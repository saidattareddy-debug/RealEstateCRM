# AI Live-Send Policy

The layered policy that governs whether an automatic responder message may ever be sent. In Phase 5B.0 the answer is always **no**: this is a record-only system and a customer-visible automatic send is impossible by construction. This document defines the gate model so that, when a reviewed 5B.1 PR eventually changes the master switch under explicit sign-off, the decision remains conservative, auditable, and fail-safe.

See [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md) for the overall readiness picture and [`AI_SECURITY.md`](./AI_SECURITY.md) for the broader AI safety model.

---

## 1. Master-switch precedence (the rule above all rules)

`LIVE_SEND_MASTER_SWITCH` is a compile-time `false` in [`packages/domain/src/ai-live-send.ts`](../packages/domain/src/ai-live-send.ts). It is a **global** master switch, distinct from any database flag. The final result of `evaluateLiveSendGates(input)` is ANDed with this constant.

The practical consequence: **database configuration alone can never enable sending.** A tenant can have channel mode set to its most permissive value, a 100% rollout percentage, both activation approvals recorded, every per-message gate passing — and the evaluation still returns `allowed = false`, because the master switch dominates. Enabling a real send requires a code change (the master switch) _and_ the runtime enablement _and_ every per-message gate, together, in a reviewed PR.

This precedence is intentional. The master switch is the single, reviewable, version-controlled line that separates "record-only" from "could send," and it sits above all data.

## 2. The 15 layered gates

`evaluateLiveSendGates(input)` evaluates the following gates. Any failing gate blocks the send; the result also records _which_ gate failed so suppression is explainable. The gates are layered from platform-wide down to per-message specifics:

1. **global_master_switch_off** — the compile-time `LIVE_SEND_MASTER_SWITCH` is false. In 5B.0 this gate always fails, so nothing downstream can authorise a send.
2. **platform** — platform-level AI sending is enabled/approved.
3. **tenant** — the tenant is enabled for live sending.
4. **channel** — the specific channel (e.g. WhatsApp, web chat, email) permits automated sending.
5. **project** — the project is approved for automated answering.
6. **not_ai_mode** — fails if the conversation `operating_mode` is not `ai` (i.e. `human`/`paused`).
7. **human_takeover** — fails if a human currently holds the conversation.
8. **conversation_not_open** — fails if the conversation lifecycle is not `open`.
9. **consent_or_dnc_blocked** — fails if consent is withdrawn or a do-not-contact entry applies for the channel (or `any`).
10. **provider_unavailable** — the AI provider is not available server-side.
11. **usage_limit_reached** — the per-tenant usage limit (hourly/daily) has been hit.
12. **not_grounded** — the answer is not grounded in approved, in-effect sources.
13. **citation_incomplete** — citation coverage is incomplete for the claims made.
14. **transport_invalid** — the delivery transport contract is not satisfied (no valid recipient/channel binding).
15. **worker_revalidation_failed** — the worker-time recheck failed (state changed since the candidate was created).

The master switch is ANDed with the constant after all gates, so even if all 15 individual gates were to pass, `allowed` stays false while the switch is false.

## 3. Per-message gates already enforced today

Several of the above gates are not theoretical — they are the same checks already enforced on every `ai_responder_decisions` row in the record-only path (see [`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md) §2). On every responder run the system already requires: `operating_mode = 'ai'`, no active human takeover, conversation `open`, no DNC / consent withdrawal, platform + tenant + project enabled, channel policy permits sending, provider available, usage limit not reached, approved + in-effect knowledge only, and a `grounded` answer with complete citation coverage — otherwise it **escalates, never guesses**. Going live does not relax any of these; it only adds the requirement that the master switch and runtime enablement also be on.

## 4. Grounding and citation are hard gates, not soft preferences

The `not_grounded` and `citation_incomplete` gates encode the platform rule that AI **proposes** but does not invent: a customer-facing project-specific factual answer must be grounded in approved, in-effect knowledge with complete citation coverage, or it is escalated to a human. There is no "best effort" send. See [`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md).

## 5. Worker revalidation

Even a candidate that passed every gate at creation time must pass `revalidateAutomaticSend(candidate, context)` at worker time, because state can change between inbound and send (a human replies, the customer sends a newer message, DNC is activated, knowledge is withdrawn, inventory goes stale). `revalidateAutomaticSend` never proceeds while the master switch is false. See [`AI_DELIVERY_LIFECYCLE.md`](./AI_DELIVERY_LIFECYCLE.md) for the full lifecycle and [`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md) for the cancellation reasons.

## 6. Summary safety check

`summarizeLiveSendEvaluations` aggregates a batch of evaluations and reports `safe` only when the headline `delivered` count is **0**. In 5B.0 this is always 0, by construction. This summary is the single number an operator (or an automated check) can watch to confirm that the record-only invariant holds.
