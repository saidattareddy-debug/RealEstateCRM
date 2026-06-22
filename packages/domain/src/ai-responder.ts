/**
 * Phase 5B — customer-facing responder DECISION (pure, deterministic).
 *
 * This is the brain of the automatic responder: given a fully-resolved context
 * (the send gates + the grounding outcome + whether a grounded candidate reply
 * exists), it decides what the responder WOULD do. It does NOT send anything —
 * delivery is performed elsewhere and is itself gated.
 *
 * HARD SAFETY INVARIANT (proven by tests): `RESPONDER_LIVE_SENDING` is a
 * compile-time `false`. While it is false, `decideResponderOutcome` can NEVER
 * return `delivered: true` and can NEVER return outcome `'deliver'` — the
 * otherwise-deliverable path is downgraded to `'suppressed'` with the canonical
 * reason `phase_5b_automatic_responder_not_enabled`. No tenant flag, project
 * flag, conversation `operating_mode`, or browser input can change this.
 */

import type { OperatingMode, Lifecycle } from './ai-guard';
import type { GroundingDecision } from './grounding';
import type { AiSendPolicyDecision } from './ai-send-policy';

/**
 * The hard live-send gate. Turning this on is a deliberate, reviewed,
 * credentialed, production step — NOT a database/row value. It stays `false`
 * while the responder is being built behind the safety boundary.
 */
export const RESPONDER_LIVE_SENDING = false as const;

export type ResponderOutcome = 'deliver' | 'escalate' | 'suppressed' | 'blocked';

export type ResponderBlocker =
  | 'live_sending_disabled'
  | 'operating_mode_not_ai'
  | 'human_takeover_active'
  | 'conversation_not_open'
  | 'do_not_contact'
  | 'consent_withdrawn'
  | 'platform_ai_disabled'
  | 'tenant_ai_disabled'
  | 'project_ai_unapproved'
  | 'channel_policy_blocked'
  | 'provider_unavailable'
  | 'daily_limit_reached'
  | 'model_not_configured'
  | 'knowledge_not_approved'
  | 'no_candidate'
  | 'not_grounded'
  | 'policy_requires_human_review'
  | 'policy_block_send';

export interface ResponderContext {
  operatingMode: OperatingMode;
  takeoverActive: boolean;
  lifecycle: Lifecycle;
  dncBlocked: boolean;
  consentWithdrawn: boolean;
  platformAiEnabled: boolean;
  tenantAiEnabled: boolean;
  projectAiApproved: boolean;
  channelPolicyAllows: boolean;
  providerAvailable: boolean;
  dailyLimitReached: boolean;
  modelConfigured: boolean;
  knowledgeApproved: boolean;
  /** Deterministic grounding outcome for the question. */
  grounding: GroundingDecision;
  /** Whether a grounded candidate reply was produced. */
  hasCandidate: boolean;
  /** Future-safe policy layer above grounding/model output. */
  autoSendPolicyDecision?: AiSendPolicyDecision;
  autoSendPolicyReason?: string | null;
}

export interface ResponderDecision {
  outcome: ResponderOutcome;
  /** Canonical reason; for the suppressed/deliverable path this is the 5B reason. */
  reason: string;
  /** Always the value of RESPONDER_LIVE_SENDING (false in this phase). */
  liveSendingEnabled: boolean;
  /** Every failing gate, for the trace. */
  blockers: ResponderBlocker[];
  /**
   * Whether an AI message was actually delivered to the customer. Typed as the
   * literal `false` — no input can make this true while live sending is off.
   */
  delivered: false;
}

/** Hard send gates: any failure means the responder must not deliver. */
function sendGateBlockers(ctx: ResponderContext): ResponderBlocker[] {
  const b: ResponderBlocker[] = [];
  if (ctx.operatingMode !== 'ai') b.push('operating_mode_not_ai');
  if (ctx.takeoverActive) b.push('human_takeover_active');
  if (ctx.lifecycle !== 'open') b.push('conversation_not_open');
  if (ctx.dncBlocked) b.push('do_not_contact');
  if (ctx.consentWithdrawn) b.push('consent_withdrawn');
  if (!ctx.platformAiEnabled) b.push('platform_ai_disabled');
  if (!ctx.tenantAiEnabled) b.push('tenant_ai_disabled');
  if (!ctx.projectAiApproved) b.push('project_ai_unapproved');
  if (!ctx.channelPolicyAllows) b.push('channel_policy_blocked');
  if (!ctx.providerAvailable) b.push('provider_unavailable');
  if (ctx.dailyLimitReached) b.push('daily_limit_reached');
  if (!ctx.modelConfigured) b.push('model_not_configured');
  if (!ctx.knowledgeApproved) b.push('knowledge_not_approved');
  return b;
}

export function decideResponderOutcome(ctx: ResponderContext): ResponderDecision {
  const blockers = sendGateBlockers(ctx);

  // A blocked send gate → the responder is blocked (a human handles it).
  if (blockers.length > 0) {
    return {
      outcome: 'blocked',
      reason: `blocked:${blockers[0]}`,
      liveSendingEnabled: RESPONDER_LIVE_SENDING,
      blockers,
      delivered: false,
    };
  }

  // Gates pass but the answer is not grounded → escalate, never guess.
  if (ctx.grounding !== 'grounded') {
    return {
      outcome: 'escalate',
      reason: `escalate:${ctx.grounding}`,
      liveSendingEnabled: RESPONDER_LIVE_SENDING,
      blockers: ['not_grounded'],
      delivered: false,
    };
  }
  if (!ctx.hasCandidate) {
    return {
      outcome: 'escalate',
      reason: 'escalate:no_candidate',
      liveSendingEnabled: RESPONDER_LIVE_SENDING,
      blockers: ['no_candidate'],
      delivered: false,
    };
  }

  if (ctx.autoSendPolicyDecision === 'block_send') {
    return {
      outcome: 'blocked',
      reason: `blocked:${ctx.autoSendPolicyReason ?? 'policy_block_send'}`,
      liveSendingEnabled: RESPONDER_LIVE_SENDING,
      blockers: ['policy_block_send'],
      delivered: false,
    };
  }
  if (ctx.autoSendPolicyDecision === 'require_human_review') {
    return {
      outcome: 'escalate',
      reason: `escalate:${ctx.autoSendPolicyReason ?? 'policy_requires_human_review'}`,
      liveSendingEnabled: RESPONDER_LIVE_SENDING,
      blockers: ['policy_requires_human_review'],
      delivered: false,
    };
  }

  // Everything passed and a grounded candidate exists. This is the ONLY path
  // that would ever deliver — but live sending is the hard gate. While it is
  // off, the message is SUPPRESSED (recorded, not sent) with the 5B reason.
  if (!RESPONDER_LIVE_SENDING) {
    return {
      outcome: 'suppressed',
      reason: 'phase_5b_automatic_responder_not_enabled',
      liveSendingEnabled: false,
      blockers: ['live_sending_disabled'],
      delivered: false,
    };
  }

  // Unreachable while RESPONDER_LIVE_SENDING is false. (When a future, reviewed,
  // credentialed live rollout flips the flag, delivery is performed by the
  // server responder AFTER this decision — never inside this pure function.)
  return {
    outcome: 'deliver',
    reason: 'grounded_send',
    liveSendingEnabled: true,
    blockers: [],
    delivered: false,
  };
}

export interface ResponderRunSummary {
  total: number;
  /** Number of decisions that actually delivered to a customer. MUST be 0
   * while live sending is disabled — this is the headline safety metric. */
  delivered: number;
  suppressed: number;
  escalate: number;
  blocked: number;
  /** True iff nothing was delivered (the responder honoured the boundary). */
  safe: boolean;
}

/**
 * Aggregate a batch of responder decisions into a safety summary. Used by the
 * evaluation harness to assert, across many scenarios, that the responder never
 * delivers while the boundary is in place.
 */
export function summarizeResponderRun(decisions: ResponderDecision[]): ResponderRunSummary {
  let delivered = 0;
  let suppressed = 0;
  let escalate = 0;
  let blocked = 0;
  for (const d of decisions) {
    if (d.delivered || d.outcome === 'deliver') delivered += 1;
    if (d.outcome === 'suppressed') suppressed += 1;
    else if (d.outcome === 'escalate') escalate += 1;
    else if (d.outcome === 'blocked') blocked += 1;
  }
  return {
    total: decisions.length,
    delivered,
    suppressed,
    escalate,
    blocked,
    safe: delivered === 0,
  };
}
