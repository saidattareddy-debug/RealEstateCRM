/**
 * Deterministic escalation decision (Phase 5A §18). Maps a situation to a fixed
 * escalation category + priority + suggested agent action. Phase 5A may create
 * escalation recommendations/internal tasks — it never sends a customer message.
 */

import type { GroundingDecision } from './grounding';

export type EscalationCategory =
  | 'insufficient_approved_knowledge'
  | 'conflicting_knowledge'
  | 'stale_inventory'
  | 'lead_requested_human'
  | 'complaint'
  | 'legal_or_contractual'
  | 'payment_issue'
  | 'refund_issue'
  | 'price_negotiation'
  | 'booking_intent'
  | 'unsupported_language'
  | 'provider_failure'
  | 'safety_policy_block'
  | 'repeated_misunderstanding'
  | 'other';

export type EscalationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface EscalationSignals {
  grounding?: GroundingDecision;
  leadRequestedHuman?: boolean;
  complaint?: boolean;
  legalOrContractual?: boolean;
  paymentIssue?: boolean;
  refundIssue?: boolean;
  priceNegotiation?: boolean;
  bookingIntent?: boolean;
  unsupportedLanguage?: boolean;
  providerFailure?: boolean;
  safetyBlocked?: boolean;
  repeatedMisunderstanding?: boolean;
}

export interface EscalationDecision {
  escalate: boolean;
  category: EscalationCategory;
  priority: EscalationPriority;
  suggestedAgentAction: string;
}

const ACTIONS: Record<EscalationCategory, string> = {
  insufficient_approved_knowledge: 'Answer from verified knowledge or add an approved source.',
  conflicting_knowledge: 'Resolve the conflicting sources before replying.',
  stale_inventory: 'Verify current inventory before confirming availability.',
  lead_requested_human: 'A human was explicitly requested — respond personally.',
  complaint: 'Handle the complaint personally and empathetically.',
  legal_or_contractual: 'Route to a qualified person; do not give legal advice.',
  payment_issue: 'Verify payment details through approved channels.',
  refund_issue: 'Follow the refund policy; involve finance if needed.',
  price_negotiation: 'Negotiation requires a human with pricing authority.',
  booking_intent: 'High intent — prioritise a personal follow-up.',
  unsupported_language: 'Requested language not reliably supported — assign a fluent agent.',
  provider_failure: 'AI provider unavailable — respond manually.',
  safety_policy_block: 'Blocked by policy — review and respond appropriately.',
  repeated_misunderstanding: 'Repeated confusion — a human should take over.',
  other: 'Review and respond personally.',
};

const PRIORITY: Record<EscalationCategory, EscalationPriority> = {
  insufficient_approved_knowledge: 'normal',
  conflicting_knowledge: 'high',
  stale_inventory: 'high',
  lead_requested_human: 'high',
  complaint: 'high',
  legal_or_contractual: 'urgent',
  payment_issue: 'urgent',
  refund_issue: 'urgent',
  price_negotiation: 'high',
  booking_intent: 'high',
  unsupported_language: 'normal',
  provider_failure: 'normal',
  safety_policy_block: 'high',
  repeated_misunderstanding: 'normal',
  other: 'normal',
};

function category(s: EscalationSignals): EscalationCategory | null {
  // Highest-stakes first (deterministic precedence).
  if (s.safetyBlocked) return 'safety_policy_block';
  if (s.legalOrContractual) return 'legal_or_contractual';
  if (s.refundIssue) return 'refund_issue';
  if (s.paymentIssue) return 'payment_issue';
  if (s.complaint) return 'complaint';
  if (s.bookingIntent) return 'booking_intent';
  if (s.priceNegotiation) return 'price_negotiation';
  if (s.leadRequestedHuman) return 'lead_requested_human';
  if (s.unsupportedLanguage || s.grounding === 'human_review_required')
    return 'unsupported_language';
  if (s.providerFailure) return 'provider_failure';
  if (s.grounding === 'conflicting_evidence') return 'conflicting_knowledge';
  if (s.grounding === 'stale_dynamic_data') return 'stale_inventory';
  if (
    s.grounding === 'insufficient_evidence' ||
    s.grounding === 'unsupported_question' ||
    s.grounding === 'policy_blocked'
  ) {
    return s.grounding === 'policy_blocked'
      ? 'safety_policy_block'
      : 'insufficient_approved_knowledge';
  }
  if (s.repeatedMisunderstanding) return 'repeated_misunderstanding';
  return null;
}

export function decideEscalation(signals: EscalationSignals): EscalationDecision {
  const cat = category(signals);
  if (!cat) {
    return {
      escalate: false,
      category: 'other',
      priority: 'low',
      suggestedAgentAction: 'No escalation required.',
    };
  }
  return {
    escalate: true,
    category: cat,
    priority: PRIORITY[cat],
    suggestedAgentAction: ACTIONS[cat],
  };
}
