# Webhook Security (Phase 7A)

This document describes the deterministic webhook-acceptance gate and the security
properties it enforces for inbound external requests.

> **Phase 7A status.** The acceptance gate is **implemented locally** in
> `packages/domain/src/integrations.ts` and exercised with **synthetic fixtures**.
> Phase 7A verifies **no real webhook domain**, registers no live endpoint, and
> performs **no external IO**. HMAC signing of the body is done by the _caller_
> (server-side); the domain only performs the **constant-time comparison** of an
> already-computed signature. Real provider webhook registration and domain
> verification are **provider-review-blocked** and **Phase 7B**. The frozen safety
> switches are preserved (`LIVE_SEND_MASTER_SWITCH=false`,
> `RESPONDER_LIVE_SENDING=false`, advisory-only scoring + matching, record-only AI
> outbox, automatic customer sending impossible).

---

## 1. The acceptance gate

`decideWebhookAcceptance(input)` is a pure, provider-independent function that
returns `{ accept, reason }`. It rejects with a specific reason in this order:

1. `unknown_integration` — the endpoint does not resolve to a known integration.
2. `disabled_integration` — the integration is disabled.
3. `wrong_method` — the HTTP method is not allowed.
4. `wrong_content_type` — the content type is not in the allow-list.
5. `oversized_payload` — the body exceeds the maximum size.
6. `missing_signature` / `invalid_signature` — only when the provider
   `requiresSignature`; missing either the provided or computed signature is
   `missing_signature`, a mismatch is `invalid_signature`.
7. `expired_timestamp` — the timestamp is outside the replay window.

Otherwise it returns `{ accept: true, reason: 'verified' }`. Providers that use a
verification-token challenge instead of a signature set `requiresSignature:
false` and skip the signature checks.

## 2. Tenant and integration come from the endpoint, never the payload

The single most important property: the tenant and integration are resolved from
the **configured webhook endpoint** (`channel_webhook_endpoints.public_path`),
**never** from anything in the request body. A payload can never name its own
tenant. This is enforced in both the domain gate (which is told
`integrationKnown` / `integrationDisabled` by the endpoint resolution) and the
server route shape.

## 3. Constant-time signature comparison

- `constantTimeEqual(a, b)` compares two strings in constant time (length check
  plus an XOR-accumulate loop), avoiding signature-timing leaks.
- The HMAC over the raw body is computed **server-side by the caller** using a
  server-only secret resolved from `secret_ref`; the **secret never reaches the
  browser** and is never stored in plaintext (see [`SECURITY.md`](./SECURITY.md)).
- The domain compares the provided signature against the caller-computed
  signature; it never holds or derives the secret itself.

## 4. Replay-window protection

`withinReplayWindow(timestamp, now, windowSeconds)` rejects timestamps outside the
allowed window (and rejects unparyable timestamps), so a captured request cannot
be replayed indefinitely. The window is provider-configurable.

## 5. Other hardening

- **Method and content-type allow-lists** reject unexpected verbs and bodies.
- **Body-size cap** rejects oversized payloads before any parsing.
- **Disabled integrations** are rejected outright.
- Uploaded/document/website text reaching the system through a webhook is treated
  as **untrusted** (prompt-injection): reference only, never instructions
  ([`SECURITY.md`](./SECURITY.md), [`AI_SECURITY.md`](./AI_SECURITY.md)).

## 6. Audit

Webhook acceptance and rejection are audited via `integration.webhook.verified`
and `integration.webhook.rejected` (the latter flagged `is_security = true`),
among the 24 Phase 7A audit actions.

## 7. What 7A does NOT do

- It registers **no real webhook** with any provider (Phase 7B,
  provider-review-blocked).
- It verifies **no real domain** and serves no live endpoint receiving real
  provider traffic (Phase 7B).
- It performs **no external IO** — every request exercised is a synthetic fixture.

See [`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md) and
[`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md).
