# AI Responder Kill-Switch

The hierarchy of controls that stop the automatic responder from sending, and what activating a kill-switch must do. In Phase 5B.0 the responder is record-only and a customer-visible automatic send is impossible by construction (see [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md)); the kill-switch model is built and modelled in the schema (migration 0020) so that, when live sending is eventually enabled in a reviewed 5B.1 PR, an operator has an immediate, auditable way to return any scope to record-only.

---

## 1. The hierarchy (broadest wins)

Controls are layered from the whole platform down to a single conversation. A stop at any higher level overrides anything permissive below it:

1. **Global platform** — the compile-time `LIVE_SEND_MASTER_SWITCH` (false in 5B.0) and the platform-level enablement. This is the broadest and most authoritative stop; while it is off, nothing anywhere can send.
2. **Tenant** — a tenant-wide stop.
3. **Channel** — `responder_channel_settings.kill_switch_active` (with `kill_switch_reason`, `last_disabled_by`, `last_disabled_at`) per tenant/channel/optional project.
4. **Project** — a project-scoped stop.
5. **Conversation** — human takeover or `operating_mode = paused` on a single conversation.

**Global precedence is absolute.** A channel may be enabled, but if the global platform switch is off, the channel cannot send. Conversely, a conversation-level human takeover stops that conversation even when everything above it is enabled. The most restrictive applicable control always wins.

## 2. What activating a kill-switch must do

When an operator activates a kill-switch at any level, the system must:

- **Stop new candidate delivery** in that scope immediately — no new automatic send candidates proceed.
- **Revalidate and suppress queued candidates.** Any `ai_send_candidates` already queued in the affected scope are re-checked by `revalidateAutomaticSend`; the active kill-switch is a cancellation reason (`kill_switch_active`), so they move to `suppressed`/`cancelled` rather than being delivered. See the stale-cancellation reasons in §3.
- **Keep human reply working.** The kill-switch stops _automatic_ sending only; agents can still reply through the normal human reply path (`sendReplyAction`), which has its own permission/consent/DNC/status/takeover checks.
- **Preserve the audit trail.** Activation writes a security-flagged audit action (`responder.killswitch.activated`) recording who, when, scope, and reason.
- **Be visible in the UIs.** The active kill-switch is displayed in the admin/channel settings surfaces and in the responder review UI (`/ai/responder`), so operators can see at a glance that a scope is halted.

## 3. Cancellation reasons

`shouldCancelStaleCandidate` ([`packages/domain/src/ai-live-send.ts`](../packages/domain/src/ai-live-send.ts)) governs why a queued candidate is cancelled rather than sent. The reasons include:

- `candidate_expired` (past `expires_at`, default `now() + 15 min`)
- `kill_switch_active`
- `human_takeover`
- `conversation_closed`
- `human_replied`
- `newer_customer_message`
- `dnc_activated`
- `consent_changed`
- `knowledge_withdrawn`
- `inventory_stale`

These are the worker-time conditions that make a previously-valid candidate unsafe to send; a kill-switch activation is one of them, and several others (human reply, conversation close, DNC activation) act as implicit, automatic kill-switches for an individual conversation.

## 4. Relationship to the broader controls

The kill-switch sits alongside the existing human-takeover and operating-mode controls ([`HUMAN_TAKEOVER.md`](./HUMAN_TAKEOVER.md)) and the layered send gates ([`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md)). It is the deliberate, explicit operator action — distinct from the automatic per-message gates — for halting automation across a scope. Permissions `responder.killswitch.manage` (granted to `client_admin` and `sales_manager` per migration 0020) gate who may activate it. In 5B.0, activating it changes nothing observable because nothing is sending; it is in place for the live phase.
