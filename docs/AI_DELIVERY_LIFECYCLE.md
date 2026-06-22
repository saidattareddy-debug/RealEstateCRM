# AI Delivery Lifecycle (Transactional Outbox)

The lifecycle a single automatic responder candidate follows, from inbound message to a delivery attempt. In Phase 5B.0 this lifecycle is **record-only and simulated**: it persists decisions and outbox candidates, runs worker-time revalidation, and exercises simulated transports, but it **never creates a customer message** — the `send_candidate_status` enum (migration 0020) has no `delivered`/`sent` value and the master switch is false. This document also specifies, for a _future_ real send, the message-creation order and the reconciliation rules that a 5B.1 worker must follow.

See [`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md) for the gate model and [`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md) for cancellation.

---

## 1. The flow (as built today, simulated)

1. **Inbound message** arrives and is acknowledged (the inbound ack is never blocked by responder work).
2. **Idempotent claim.** A deterministic idempotency key is computed (§3) and used to claim the work exactly once; a duplicate inbound cannot create a second candidate.
3. **Retrieve + ground.** The orchestrator retrieves approved, in-effect knowledge and grounds a candidate answer (shadow/mock in 5B.0).
4. **Persist the decision.** An `ai_responder_decisions` row is written — `outcome in ('escalate','suppressed','blocked')` only (the CHECK forbids `deliver`).
5. **Persist the prompt / knowledge snapshot.** The candidate records `prompt_version`, `knowledge_snapshot_id`, `grounding_version`, `conversation_state_version`, `triggering_inbound_message_id`, and `latest_message_id_at_creation`, so the worker can later detect staleness.
6. **Create the delivery candidate in the same transaction.** An `ai_send_candidates` row is created atomically with the decision/snapshot, with `idempotency_key` unique per tenant and `expires_at` defaulting to `now() + 15 min`. `candidate_body` is internal-only and never customer-visible.
7. **Commit.**
8. **Worker claims** the candidate from the outbox.
9. **Revalidate all gates** via `revalidateAutomaticSend(candidate, context)`. State may have changed since creation; if any gate now fails the candidate is suppressed/cancelled (§ kill-switch reasons). The worker **never proceeds while the master switch is false**.
10. **Dry-run transport.** In 5B.0 the worker uses one of the four simulated `OutboundDeliveryTransport` implementations (dry-run, failure-retryable, timeout-uncertain, success-simulation).
11. **Record the simulated result** in `simulated_result` (jsonb) and an `ai_send_attempts` row. The success simulation records a `sim-<key>` provider reference with `simulated: true`.
12. **Never create a customer message.** No `conversation_messages` row, no delivery row, no status/waiting-on/unread change is created. The candidate can only ever reach `pending | revalidating | suppressed | simulated | cancelled | dead_letter`.

The transactional-outbox shape (decision + snapshot + candidate committed together, worker claims afterwards) is what makes a future real send safe: the decision and the intent-to-send are durably linked before any external IO is attempted.

## 2. Message-creation order for a future real send

For a real 5B.1 send, the central question is **when** the pending `conversation_messages` row is created relative to provider acceptance. There are two options:

- **(A) Create the local message _before_ calling the provider.** Risk: if the provider call fails, times out, or the process dies after the insert, the customer sees a "sent" message in the inbox that may never have been delivered — a **ghost send**.
- **(B) Create the local message _only after_ the provider accepts**, finalized idempotently against the candidate's idempotency key.

**Decision: use option (B) — create the `conversation_messages` row only after provider acceptance, finalized idempotently.**

Justification: option (B) prevents ghost sends by construction — there is no local "sent" message until the provider has actually accepted the outbound. The provider's acceptance reference (a real message ref, analogous to today's `sim-<key>`) is the trigger for creating exactly one local message, keyed on the candidate idempotency key so a retry or a duplicate callback cannot create a second message. An uncertain/timeout result does **not** create a message; it goes to manual review (§4).

The chosen strategy (B) must prevent all of:

- **Ghost sends** — a local "sent" message that was never delivered.
- **Provider success without local reconciliation** — the provider accepted but no local record exists. Handled by idempotent finalization keyed on the candidate (a known provider ref always resolves to exactly one local message).
- **Duplicate customer messages** — two local messages (or two provider sends) for one inbound. Prevented by the unique idempotency key and never-resend reconciliation.
- **Wrong waiting-on** — `waiting_on` must reflect that the system answered (not the customer) only when a message was actually created.
- **Wrong unread** — unread/read counts must only change when a real message exists.

## 3. Idempotency key composition

`buildAutomaticSendIdempotencyKey(parts)` ([`packages/domain/src/ai-live-send.ts`](../packages/domain/src/ai-live-send.ts)) composes the key from:

- tenant
- conversation
- triggering inbound message
- responder policy version
- prompt version
- model config
- knowledge snapshot
- attempt type

The `ai_send_candidates.idempotency_key` column is **unique per tenant** (migration 0020). A single inbound therefore maps to at most one candidate, and re-processing the same inbound under the same policy/prompt/model/knowledge produces the same key — a no-op on conflict. Changing any composed part (e.g. a new prompt version) intentionally yields a different key, so the same inbound under a _different_ configuration is a distinct candidate, never a silent duplicate of the old one.

## 4. External-success reconciliation

When a real provider call returns an uncertain or timed-out result, the local state cannot assume failure (the message may have been delivered) and must never blindly resend:

- `reconcileUncertainAttempt` **never resends** an uncertain/timeout attempt. It routes the attempt to a `manual_review` state (`send_attempt_status` includes `manual_review`) for a human to confirm.
- If a **known provider message reference** is present, the attempt is treated as **confirmed** — the provider accepted the outbound — and no resend occurs; the local message is finalized idempotently against the candidate key.
- **Idempotent callbacks.** Provider delivery/status callbacks must be idempotent: a replayed callback for an already-finalized candidate is a no-op, never a second message or a second state change.

This is the same contract exercised today against the simulated transports; in 5B.0 it runs but no real provider is called and no customer message is ever created.
