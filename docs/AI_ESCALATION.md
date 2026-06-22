# AI Escalation

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §18 and built in Phase 5A. When the system cannot or should not answer, it escalates to a human. Escalation is a deterministic mapping from a situation to a fixed category, priority, and suggested agent action. Crucially, in Phase 5A escalation **only recommends** — it creates an internal recommendation/decision record and never sends a customer-facing message. The pure logic lives in [`packages/domain/src/ai-escalation.ts`](../packages/domain/src/ai-escalation.ts).

Companion docs: [`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md) (the upstream decision) and [`AI_SECURITY.md`](./AI_SECURITY.md) (the no-send boundary).

---

## 1. Categories

`decideEscalation(signals)` returns one `EscalationCategory`:

`insufficient_approved_knowledge`, `conflicting_knowledge`, `stale_inventory`, `lead_requested_human`, `complaint`, `legal_or_contractual`, `payment_issue`, `refund_issue`, `price_negotiation`, `booking_intent`, `unsupported_language`, `provider_failure`, `safety_policy_block`, `repeated_misunderstanding`, and `other`.

## 2. Deterministic precedence

Signals are evaluated highest-stakes first, so the outcome is stable: safety block → legal/contractual → refund → payment → complaint → booking intent → price negotiation → lead-requested-human → unsupported language → provider failure → grounding-derived categories (conflicting/stale/insufficient) → repeated misunderstanding. Grounding outcomes map straight through: `conflicting_evidence` → `conflicting_knowledge`, `stale_dynamic_data` → `stale_inventory`, `insufficient_evidence`/`unsupported_question` → `insufficient_approved_knowledge`, `policy_blocked` → `safety_policy_block`, `human_review_required` → `unsupported_language`. When nothing triggers, `escalate` is false.

## 3. Priority mapping

Each category carries a fixed priority used for queueing and SLA:

| Priority | Categories                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `urgent` | `legal_or_contractual`, `payment_issue`, `refund_issue`                                                                                       |
| `high`   | `conflicting_knowledge`, `stale_inventory`, `lead_requested_human`, `complaint`, `price_negotiation`, `booking_intent`, `safety_policy_block` |
| `normal` | `insufficient_approved_knowledge`, `unsupported_language`, `provider_failure`, `repeated_misunderstanding`, `other`                           |
| `low`    | (no escalation required)                                                                                                                      |

## 4. Suggested agent actions

Every category maps to a fixed, human-readable suggested action — for example, `legal_or_contractual` → "Route to a qualified person; do not give legal advice"; `stale_inventory` → "Verify current inventory before confirming availability"; `price_negotiation` → "Negotiation requires a human with pricing authority"; `lead_requested_human` → "A human was explicitly requested — respond personally". These are guidance for the agent, surfaced on the copilot panel and in the escalation record, not instructions executed by the system.

## 5. Recommend, never send

In Phase 5A an escalation produces:

- a recommendation/decision row in `ai_escalation_decisions` (category, reason, evidence state, suggested action, priority, status), audited as `ai.escalation.recommended`; and
- an escalation **draft note** on the copilot panel of the form `"[escalation:<category>] <suggested action>"`.

It does **not** send any customer message, change conversation operating mode, or mark the lead. A human reads the recommendation and acts. Sending any reply remains a separate, human-initiated action through the normal reply path with its own consent/DNC/status checks — see [`AI_SECURITY.md`](./AI_SECURITY.md) §1.
