# AI Responder Rollout Plan

How the automatic responder would move, eventually, from record-only to a narrow, measured, reversible live rollout. In Phase 5B.0 nothing in this plan is active — the responder is record-only and a customer-visible automatic send is impossible (see [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md) and [`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md)). This plan defines the _measurable_ acceptance criteria and the conservative canary policy that must be satisfied first, so the eventual 5B.1 go-live decision rests on evidence, not optimism.

The thresholds below are deliberately left as configurable placeholders. Production numbers are **not** invented here; each threshold requires written approval from product (and, where relevant, legal) before it becomes binding.

---

## 1. Shadow-soak: measurable acceptance criteria

Before any live send, the responder runs in its current record-only mode against live traffic for an agreed period, and its recorded (non-sent) candidates are reviewed on `/ai/responder`. Sign-off requires the following to be tracked and reviewed:

- Total candidates generated.
- Grounded percentage (share of candidates whose answer was grounded with complete citations).
- Escalation percentage (share routed to a human instead of answered).
- Unsupported-claim rate (claims not supported by an approved source).
- Citation coverage and citation correctness.
- Stale-data suppression (candidates suppressed because inventory/price data was stale).
- Conflict suppression (candidates suppressed because sources conflicted).
- Provider-error rate.
- Latency, average and percentile (e.g. p50/p95/p99).
- Token usage.
- Cost.
- Per-language results (each tracked metric broken out by language).
- Human reviewer accept / edit / discard rates on the recorded candidates.
- Critical safety violations (any of the hard-zero items below).

### Hard requirements (must be exactly zero)

The soak does not pass while any of these is non-zero:

- Zero cross-tenant data leakage.
- Zero unauthorized sends.
- Zero do-not-contact / consent violations.
- Zero uncited project-specific factual sends.
- Zero confirmed duplicate-send candidates.
- Zero critical prompt-injection failures.

### Thresholds

The remaining metrics (grounded %, escalation %, unsupported-claim rate, citation coverage, provider-error rate, latency, cost, per-language quality, human accept/edit/discard) each have a target threshold that is **configurable and requires written approval**. This document does not set production numbers; product fills them in before go-live and records the approval.

## 2. Canary policy — low-risk categories only

When live sending is eventually enabled, it begins as a low-risk canary: the responder may send **only** for an explicitly approved set of categories, and must escalate everything else.

**Allowed (only if explicitly approved):**

- Greeting / acknowledgement.
- Callback-time request (asking when the customer would like a call).
- Basic requirement capture (budget range, location, configuration preference).
- Approved project overview (from approved knowledge).
- Approved amenity FAQ (from approved knowledge).
- Human-handoff confirmation.

**Blocked (always escalate, never auto-send):**

- Inventory confirmation (specific unit availability).
- Price, discount, payment, booking, or refund commitments.
- Legal, tax, or investment advice.
- Complaint resolution.
- Negotiation.
- Unsupported languages.
- Any answer drawing on conflicting or stale information.

The blocked list maps directly onto the grounding and conflict/stale gates in [`AI_LIVE_SEND_POLICY.md`](./AI_LIVE_SEND_POLICY.md): a category that cannot be answered from approved, in-effect, non-conflicting knowledge is escalated.

## 3. Staged rollout

- **One tenant, one channel first.** Live sending is enabled for a single, low-risk tenant/channel, observed against the acceptance criteria, then expanded gradually. The `rollout_percentage` column on `responder_channel_settings` (migration 0020) supports a partial rollout within that channel.
- **Reversible at every step.** The kill-switch ([`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md)) returns a tenant/channel to record-only immediately and revalidates/suppresses any queued candidates.
- **One code path for both deployment modes.** Shared multi-tenant and dedicated enterprise deployments use the same code; differences are env/config/flags only, never forks. The rollout sequence is identical in both modes.

## 4. Activation governance

Enabling a channel for live sending is a two-person action recorded in `responder_activation_requests` + `responder_activation_approvals` (migration 0020): a requester raises a request, and a _different_ approver (the `responder_approval_requester_guard` trigger prevents self-approval) signs off, with approval roles spanning product, engineering, and legal. This is in addition to — not a replacement for — the compile-time master switch and the per-message gates. See [`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md) §6.
