# WhatsApp Messaging Policy (Phase 7A)

This document describes the deterministic WhatsApp messaging-policy evaluation:
the gate that classifies whether a message _could_ be sent under session,
template, consent, and do-not-contact rules.

> **Phase 7A status.** The policy evaluation is **implemented locally** in
> `packages/domain/src/integrations.ts` and runs against **synthetic** inputs.
> Phase 7A sends **nothing**: a `session_messaging_allowed` result still produces
> only a **simulation**. The 24-hour session window, consent, and DNC inputs are
> **mock-only** in 7A (no live conversation data drives them yet). The frozen
> safety switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
> `RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
> outbox, automatic customer sending impossible). Enforcement against live traffic
> is **Phase 7B** and **compliance-blocked**.

---

## 1. The policy states

`evaluateWhatsAppPolicy(input)` returns exactly one state:

- `session_messaging_allowed` — a free-form reply is within the session window.
- `approved_template_required` — outside the session window; only an approved
  template may be used.
- `messaging_blocked` — messaging is not permitted.
- `consent_blocked` — consent has not been granted.
- `dnc_blocked` — the contact has opted out or is on do-not-contact.
- `provider_unavailable` — the provider is not available.
- `policy_unknown` — policy state cannot be determined.
- `human_review_required` — a human must decide.

## 2. Evaluation order (fail-safe)

The evaluation is deliberately ordered so the **most restrictive** condition wins:

1. policy not known → `policy_unknown`,
2. provider unavailable → `provider_unavailable`,
3. opted out → `dnc_blocked`,
4. DNC active → `dnc_blocked`,
5. consent not granted → `consent_blocked`,
6. within the session window → `session_messaging_allowed`,
7. otherwise → `approved_template_required`.

So an unknown/blocked/consent/DNC condition always short-circuits before any
"allowed" result. This mirrors the conversation-layer consent/DNC enforcement
([`SECURITY.md`](./SECURITY.md), [`CONVERSATIONS.md`](./CONVERSATIONS.md)).

## 3. The session window

`whatsapp_conversation_windows` records `last_inbound_at`, a `policy_state`, a
`policy_version`, and `last_evaluated_at`. The window age is compared against a
configurable `sessionWindowHours` (the WhatsApp 24-hour rule). In 7A this state is
**synthetic** and not yet driven by live inbound traffic.

## 4. Policy result is advisory in 7A

Even when the policy returns `session_messaging_allowed` or
`approved_template_required`, **no message is sent**. The result only informs the
human-send **simulation** ([`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md))
and the UI. The live-send master switch is false and there is no automatic send
path.

## 5. What is Phase 7B

Driving the policy from live conversation windows, enforcing it before a real
send, and the actual consent/DNC/template enforcement against live WhatsApp
traffic — all **Phase 7B**, and **compliance-blocked** pending privacy/legal
sign-off.

See [`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md) and
[`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md).
