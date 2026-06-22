/**
 * HARD AI execution boundary (Phase 4.1 §2).
 *
 * `canExecuteAutomatedReply` is the single place that decides whether an
 * automated reply may be produced. There are NO scattered AI checks elsewhere —
 * every future call site must consult this function.
 *
 * Until Phase 5 installs a production responder, this ALWAYS denies: a database
 * flag alone can never activate AI. The flag below is a compile-time constant,
 * not a tenant/row value.
 */

export const AI_RESPONDER_INSTALLED = false as const;

export type OperatingMode = 'human' | 'paused' | 'ai';
export type Lifecycle = 'open' | 'paused' | 'resolved' | 'closed' | 'spam' | 'archived';

export interface AutomatedReplyContext {
  tenantId: string;
  conversationId: string;
  operatingMode: OperatingMode;
  takeoverActive: boolean;
  lifecycle: Lifecycle;
  /** Outbound contact would violate consent / do-not-contact. */
  dncBlocked: boolean;
  consentWithdrawn: boolean;
  /** Tenant AI feature flag explicitly enabled. */
  tenantAiEnabled: boolean;
  /** Project has an approved AI configuration. */
  projectAiApproved: boolean;
  /** An approved model configuration exists for this task. */
  modelConfigured: boolean;
  /** Approved knowledge exists for project-specific answering. */
  knowledgeApproved: boolean;
  /**
   * The level the caller is requesting. Legacy callers omit it (treated as a
   * plain gate check). An explicit `'automatic'` request is denied with the
   * Phase-5B reason — a production responder is required first.
   */
  requestedLevel?: AiOperatingLevel;
}

export type DenialReason =
  | 'no_responder_installed'
  | 'phase_5b_automatic_responder_not_enabled'
  | 'tenant_ai_disabled'
  | 'project_ai_unapproved'
  | 'operating_mode_not_ai'
  | 'human_takeover_active'
  | 'conversation_not_open'
  | 'do_not_contact'
  | 'consent_withdrawn'
  | 'model_not_configured'
  | 'knowledge_not_approved';

/**
 * The four AI operating levels (Phase 5A §2). Only Disabled / Shadow / Copilot
 * are permitted in 5A; Automatic is ALWAYS denied until the Phase-5B responder
 * is installed. No level may cause an AI message to be sent automatically.
 */
export type AiOperatingLevel = 'disabled' | 'shadow' | 'copilot' | 'automatic';

export interface AutomatedReplyDecision {
  allowed: boolean;
  reason: DenialReason | null;
  tenantId: string;
  conversationId: string;
  operatingMode: OperatingMode;
  takeoverState: boolean;
  consentState: 'ok' | 'withdrawn';
  dncState: 'ok' | 'blocked';
  featureStatus: 'enabled' | 'disabled';
  knowledgeStatus: 'approved' | 'missing';
  modelStatus: 'configured' | 'missing';
}

/**
 * Returns a fully-populated decision. `allowed` is true only when EVERY gate
 * passes AND a production responder is installed. Because no responder is
 * installed pre-Phase-5, the result is always denied.
 */
export function canExecuteAutomatedReply(ctx: AutomatedReplyContext): AutomatedReplyDecision {
  const base: Omit<AutomatedReplyDecision, 'allowed' | 'reason'> = {
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId,
    operatingMode: ctx.operatingMode,
    takeoverState: ctx.takeoverActive,
    consentState: ctx.consentWithdrawn ? 'withdrawn' : 'ok',
    dncState: ctx.dncBlocked ? 'blocked' : 'ok',
    featureStatus: ctx.tenantAiEnabled ? 'enabled' : 'disabled',
    knowledgeStatus: ctx.knowledgeApproved ? 'approved' : 'missing',
    modelStatus: ctx.modelConfigured ? 'configured' : 'missing',
  };

  // Evaluated in priority order. The responder gate is checked FIRST and last:
  // even a fully-configured tenant cannot execute AI until Phase 5.
  const deny = (reason: DenialReason): AutomatedReplyDecision => ({
    ...base,
    allowed: false,
    reason,
  });

  // An explicit automatic request is rejected with the Phase-5B reason BEFORE
  // anything else — no combination of database flags or browser inputs can make
  // an automatic send allowed in 5A.
  if (ctx.requestedLevel === 'automatic') return deny('phase_5b_automatic_responder_not_enabled');
  if (!AI_RESPONDER_INSTALLED) return deny('no_responder_installed');
  if (ctx.takeoverActive) return deny('human_takeover_active');
  if (ctx.lifecycle !== 'open') return deny('conversation_not_open');
  if (ctx.operatingMode !== 'ai') return deny('operating_mode_not_ai');
  if (!ctx.tenantAiEnabled) return deny('tenant_ai_disabled');
  if (!ctx.projectAiApproved) return deny('project_ai_unapproved');
  if (ctx.dncBlocked) return deny('do_not_contact');
  if (ctx.consentWithdrawn) return deny('consent_withdrawn');
  if (!ctx.modelConfigured) return deny('model_not_configured');
  if (!ctx.knowledgeApproved) return deny('knowledge_not_approved');

  // Unreachable until AI_RESPONDER_INSTALLED flips in Phase 5.
  return { ...base, allowed: true, reason: null };
}

/**
 * The Resume control may only move a conversation OUT of human takeover into a
 * non-AI mode. It must never set 'ai'. Returns the safe target mode.
 */
export function resumeTargetMode(requested: 'human' | 'paused'): OperatingMode {
  return requested === 'paused' ? 'paused' : 'human';
}

// ---------------------------------------------------------------------------
// Phase 5A — level-aware execution evaluation
// ---------------------------------------------------------------------------

export interface AiExecutionContext extends AutomatedReplyContext {
  /** The operating level being attempted. */
  level: AiOperatingLevel;
  /** Platform-wide AI feature kill switch (default on). */
  platformAiEnabled?: boolean;
  /** Channel policy permits AI assistance on this channel (default on). */
  channelPolicyAllows?: boolean;
  /** Retrieval produced sufficient grounded evidence (default false). */
  retrievalSufficient?: boolean;
  /** Conflicting approved knowledge was detected (default false). */
  conflictsPresent?: boolean;
  /** Dynamic operational data (e.g. inventory) is stale (default false). */
  staleDynamicData?: boolean;
  /** A processing lock is already held for this conversation (default false). */
  processingLockHeld?: boolean;
  /** Daily/period usage limit reached (default false). */
  dailyLimitReached?: boolean;
  /** A usable provider (mock or external) is available (default true — mock). */
  providerAvailable?: boolean;
}

export type ExecutionBlocker =
  | 'automatic_disabled_phase_5a'
  | 'level_disabled'
  | 'platform_ai_disabled'
  | 'tenant_ai_disabled'
  | 'project_ai_unapproved'
  | 'channel_policy_blocked'
  | 'model_not_configured'
  | 'knowledge_not_approved'
  | 'provider_unavailable'
  | 'processing_locked'
  | 'daily_limit_reached';

export interface AiExecutionDecision {
  level: AiOperatingLevel;
  /** Shadow/Copilot may produce an AGENT-FACING draft when gates pass. */
  mayGenerateDraft: boolean;
  /**
   * Whether an AI message may be sent to the customer automatically. In Phase 5A
   * this is ALWAYS false, for every level and every input combination.
   */
  maySendAutomatically: false;
  reason: DenialReason | null;
  /** All failing generation gates, for the AI run trace. */
  blockers: ExecutionBlocker[];
}

/**
 * Phase 5A execution decision. Hard invariants, proven by tests:
 *   1. `maySendAutomatically` is the literal `false` — no input can flip it.
 *   2. `level: 'automatic'` is always denied with the Phase-5B reason.
 *   3. Draft generation (Shadow/Copilot) is permitted only when every generation
 *      gate passes; it still NEVER authorises an automatic customer send.
 *
 * Sending an edited Copilot draft is a SEPARATE, human-initiated action that
 * must independently pass reply-permission / consent / DNC / conversation-state
 * checks — this function never authorises that path.
 */
export function evaluateAiExecution(ctx: AiExecutionContext): AiExecutionDecision {
  const blockers: ExecutionBlocker[] = [];

  // Automatic can never run in 5A — short-circuit with the canonical reason.
  if (ctx.level === 'automatic') {
    return {
      level: 'automatic',
      mayGenerateDraft: false,
      maySendAutomatically: false,
      reason: 'phase_5b_automatic_responder_not_enabled',
      blockers: ['automatic_disabled_phase_5a'],
    };
  }
  if (ctx.level === 'disabled') {
    return {
      level: 'disabled',
      mayGenerateDraft: false,
      maySendAutomatically: false,
      reason: null,
      blockers: ['level_disabled'],
    };
  }

  // Shadow / Copilot: evaluate the generation gates (these gate DRAFTING, never
  // sending). Defaults are chosen so a missing signal is treated safely.
  if (ctx.platformAiEnabled === false) blockers.push('platform_ai_disabled');
  if (!ctx.tenantAiEnabled) blockers.push('tenant_ai_disabled');
  if (!ctx.projectAiApproved) blockers.push('project_ai_unapproved');
  if (ctx.channelPolicyAllows === false) blockers.push('channel_policy_blocked');
  if (!ctx.modelConfigured) blockers.push('model_not_configured');
  if (!ctx.knowledgeApproved) blockers.push('knowledge_not_approved');
  if (ctx.providerAvailable === false) blockers.push('provider_unavailable');
  if (ctx.processingLockHeld === true) blockers.push('processing_locked');
  if (ctx.dailyLimitReached === true) blockers.push('daily_limit_reached');

  return {
    level: ctx.level,
    mayGenerateDraft: blockers.length === 0,
    maySendAutomatically: false,
    reason: null,
    blockers,
  };
}
