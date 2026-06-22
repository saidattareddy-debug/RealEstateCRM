/**
 * Phase 5B.0 — live-send safety core (RECORD-ONLY).
 *
 * This module models everything required to deliver an automatic reply to a real
 * customer — gate evaluation, idempotency, worker-time revalidation, stale-
 * candidate cancellation, a provider-neutral delivery transport, and external-
 * success reconciliation — WITHOUT ever performing a real send.
 *
 * The headline invariant (proven by tests): `LIVE_SEND_MASTER_SWITCH` is a
 * compile-time `false`. While it is false, `evaluateLiveSendGates` can NEVER
 * return `allowed: true`, regardless of every database flag being on, and
 * `revalidateAutomaticSend` can NEVER return `proceed: true`. Database
 * configuration alone can never enable sending.
 */

import { fnv1aHex } from './chunking';

/**
 * GLOBAL deployment-level master live-send switch. This is NOT a database row —
 * it is a compile-time constant, the outermost of the layered kill switches.
 * In Phase 5B.0 it is `false`; flipping it is a separately reviewed 5B.1 PR.
 */
export const LIVE_SEND_MASTER_SWITCH = false as const;

/**
 * Runtime responder modes for a tenant/channel. There is intentionally NO
 * active `live` mode while the master switch is false — the strongest runtime
 * mode is `live_candidate`, which still only produces suppressed/simulated
 * outcomes.
 */
export const RESPONDER_MODES = ['disabled', 'shadow', 'copilot', 'live_candidate'] as const;
export type ResponderMode = (typeof RESPONDER_MODES)[number];

export type SupportedChannel = 'website_chat' | 'whatsapp' | 'email' | 'voice';

// ---------------------------------------------------------------------------
// 1. Layered send-gate evaluation (master-switch precedence)
// ---------------------------------------------------------------------------

export type LiveSendGate =
  | 'global_master_switch_off'
  | 'platform_disabled'
  | 'tenant_disabled'
  | 'channel_disabled'
  | 'project_disabled'
  | 'not_ai_mode'
  | 'human_takeover'
  | 'conversation_not_open'
  | 'consent_or_dnc_blocked'
  | 'provider_unavailable'
  | 'usage_limit_reached'
  | 'not_grounded'
  | 'citation_incomplete'
  | 'transport_invalid'
  | 'worker_revalidation_failed';

export interface LiveSendGateInput {
  /** Caller's view of the master switch. ANDed with the constant — a `true`
   * here can never override the compile-time `false`. */
  masterSwitchOn: boolean;
  platformEnabled: boolean;
  tenantEnabled: boolean;
  channelEnabled: boolean;
  /** Project policy applies only where configured. */
  projectEnabled: boolean;
  operatingModeAi: boolean;
  humanTakeover: boolean;
  conversationOpen: boolean;
  consentAndDncAllowed: boolean;
  providerAvailable: boolean;
  usageWithinLimits: boolean;
  grounded: boolean;
  citationComplete: boolean;
  transportValid: boolean;
  /** Worker-time revalidation passed (true at decision time before the worker). */
  workerRevalidationOk: boolean;
}

export interface LiveSendEvaluation {
  /** True only if the master switch is on AND every gate passes. Always false
   * in 5B.0 because the master switch constant is false. */
  allowed: boolean;
  masterSwitchOn: boolean;
  failedGates: LiveSendGate[];
  /** Canonical, customer-safe reason recorded when not allowed. */
  suppressedReason: string;
}

export function evaluateLiveSendGates(input: LiveSendGateInput): LiveSendEvaluation {
  // The constant is the outermost gate: a database flag cannot override it.
  const masterSwitchOn = LIVE_SEND_MASTER_SWITCH && input.masterSwitchOn;

  const failed: LiveSendGate[] = [];
  if (!masterSwitchOn) failed.push('global_master_switch_off');
  if (!input.platformEnabled) failed.push('platform_disabled');
  if (!input.tenantEnabled) failed.push('tenant_disabled');
  if (!input.channelEnabled) failed.push('channel_disabled');
  if (!input.projectEnabled) failed.push('project_disabled');
  if (!input.operatingModeAi) failed.push('not_ai_mode');
  if (input.humanTakeover) failed.push('human_takeover');
  if (!input.conversationOpen) failed.push('conversation_not_open');
  if (!input.consentAndDncAllowed) failed.push('consent_or_dnc_blocked');
  if (!input.providerAvailable) failed.push('provider_unavailable');
  if (!input.usageWithinLimits) failed.push('usage_limit_reached');
  if (!input.grounded) failed.push('not_grounded');
  if (!input.citationComplete) failed.push('citation_incomplete');
  if (!input.transportValid) failed.push('transport_invalid');
  if (!input.workerRevalidationOk) failed.push('worker_revalidation_failed');

  const allowed = masterSwitchOn && failed.length === 0;
  const suppressedReason = !masterSwitchOn
    ? 'phase_5b1_live_send_master_switch_off'
    : failed.length > 0
      ? `suppressed:${failed[0]}`
      : 'grounded_send_pending_activation';

  return { allowed, masterSwitchOn, failedGates: failed, suppressedReason };
}

// ---------------------------------------------------------------------------
// 2. Canonical automatic-send idempotency key
// ---------------------------------------------------------------------------

export interface AutomaticSendKeyParts {
  tenantId: string;
  conversationId: string;
  triggeringInboundMessageId: string;
  responderPolicyVersion: string;
  promptVersion: string;
  modelConfigId: string;
  knowledgeSnapshotId: string;
  attemptType: string;
}

/**
 * A deterministic key derived from stable identifiers. Enforced UNIQUE at the
 * database level so one inbound customer message yields at most one successful
 * automatic send.
 */
export function buildAutomaticSendIdempotencyKey(parts: AutomaticSendKeyParts): string {
  return fnv1aHex(
    [
      parts.tenantId,
      parts.conversationId,
      parts.triggeringInboundMessageId,
      parts.responderPolicyVersion,
      parts.promptVersion,
      parts.modelConfigId,
      parts.knowledgeSnapshotId,
      parts.attemptType,
    ].join('|'),
  );
}

// ---------------------------------------------------------------------------
// 3. Stale-candidate cancellation
// ---------------------------------------------------------------------------

export type CancellationReason =
  | 'candidate_expired'
  | 'kill_switch_active'
  | 'human_replied'
  | 'newer_customer_message'
  | 'human_takeover'
  | 'conversation_closed'
  | 'consent_changed'
  | 'dnc_activated'
  | 'knowledge_withdrawn'
  | 'inventory_stale';

export interface AutomaticSendCandidate {
  id: string;
  tenantId: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
  triggeringInboundMessageId: string;
  conversationStateVersion: number;
  latestMessageIdAtCreation: string;
  promptVersion: string;
  knowledgeSnapshotId: string;
  groundingVersion: string;
}

export interface CandidateCurrentState {
  now: Date;
  killSwitchActive: boolean;
  humanReplied: boolean;
  latestInboundMessageId: string;
  humanTakeover: boolean;
  conversationClosed: boolean;
  consentChanged: boolean;
  dncActivated: boolean;
  knowledgeWithdrawn: boolean;
  inventoryStale: boolean;
}

export interface CancellationCheck {
  cancel: boolean;
  reason: CancellationReason | null;
}

/** Decide whether a queued candidate must be cancelled/suppressed because the
 * conversation moved on since it was generated. Order: hardest stops first. */
export function shouldCancelStaleCandidate(
  candidate: AutomaticSendCandidate,
  state: CandidateCurrentState,
): CancellationCheck {
  const expired = state.now.getTime() > new Date(candidate.expiresAt).getTime();
  if (expired) return { cancel: true, reason: 'candidate_expired' };
  if (state.killSwitchActive) return { cancel: true, reason: 'kill_switch_active' };
  if (state.humanTakeover) return { cancel: true, reason: 'human_takeover' };
  if (state.conversationClosed) return { cancel: true, reason: 'conversation_closed' };
  if (state.humanReplied) return { cancel: true, reason: 'human_replied' };
  if (state.latestInboundMessageId !== candidate.triggeringInboundMessageId)
    return { cancel: true, reason: 'newer_customer_message' };
  if (state.dncActivated) return { cancel: true, reason: 'dnc_activated' };
  if (state.consentChanged) return { cancel: true, reason: 'consent_changed' };
  if (state.knowledgeWithdrawn) return { cancel: true, reason: 'knowledge_withdrawn' };
  if (state.inventoryStale) return { cancel: true, reason: 'inventory_stale' };
  return { cancel: false, reason: null };
}

// ---------------------------------------------------------------------------
// 4. Worker-time revalidation (immediately before any delivery)
// ---------------------------------------------------------------------------

export interface WorkerContext {
  gateInput: LiveSendGateInput;
  currentState: CandidateCurrentState;
}

export interface AutomaticSendRevalidation {
  /** Whether the worker may proceed to deliver. Always false in 5B.0. */
  proceed: boolean;
  cancelled: boolean;
  suppressedReason: string;
  failedGates: LiveSendGate[];
  cancellationReason: CancellationReason | null;
}

/**
 * Re-check every gate and staleness condition immediately before delivery. The
 * worker must suppress when the master switch is off, any gate fails, or the
 * candidate is stale. Records the safe suppression reason.
 */
export function revalidateAutomaticSend(
  candidate: AutomaticSendCandidate,
  context: WorkerContext,
): AutomaticSendRevalidation {
  const cancellation = shouldCancelStaleCandidate(candidate, context.currentState);
  const evaluation = evaluateLiveSendGates(context.gateInput);
  const proceed = evaluation.allowed && !cancellation.cancel;
  const suppressedReason = cancellation.cancel
    ? `cancelled:${cancellation.reason}`
    : evaluation.suppressedReason;
  return {
    proceed,
    cancelled: cancellation.cancel,
    suppressedReason,
    failedGates: evaluation.failedGates,
    cancellationReason: cancellation.reason,
  };
}

// ---------------------------------------------------------------------------
// 5. Provider-neutral delivery transport (SIMULATION ONLY)
// ---------------------------------------------------------------------------

export type OutboundDeliveryStatus = 'accepted' | 'failed' | 'timeout' | 'simulated';

export interface OutboundDeliveryRequest {
  idempotencyKey: string;
  channel: SupportedChannel;
  conversationId: string;
  body: string;
  correlationId: string;
}

export interface DeliveryContext {
  now: Date;
  /** Always true in 5B.0 — no transport performs a real external send. */
  dryRun: boolean;
}

export interface OutboundDeliveryResult {
  status: OutboundDeliveryStatus;
  providerMessageRef: string | null;
  acceptedAt: string | null;
  retryable: boolean;
  errorCode: string | null;
  errorSummary: string | null;
  correlationId: string;
  /** Always true here — no result represents a real customer-visible send. */
  simulated: boolean;
}

export interface DeliveryReconciliationRequest {
  idempotencyKey: string;
  priorStatus: OutboundDeliveryStatus;
  providerMessageRef: string | null;
}

export interface DeliveryReconciliationResult {
  resolution: 'confirmed_simulated' | 'still_uncertain' | 'manual_review' | 'not_sent';
  safe: boolean;
  /** Whether the worker may resend. Never true for an uncertain accepted send. */
  resend: boolean;
}

export interface OutboundDeliveryTransport {
  readonly channel: SupportedChannel;
  send(request: OutboundDeliveryRequest, context: DeliveryContext): Promise<OutboundDeliveryResult>;
  reconcile?(
    request: DeliveryReconciliationRequest,
    context: DeliveryContext,
  ): Promise<DeliveryReconciliationResult>;
}

function simResult(
  correlationId: string,
  over: Partial<OutboundDeliveryResult>,
): OutboundDeliveryResult {
  return {
    status: 'simulated',
    providerMessageRef: null,
    acceptedAt: null,
    retryable: false,
    errorCode: null,
    errorSummary: null,
    correlationId,
    simulated: true,
    ...over,
  };
}

/** Dry-run transport — records intent, performs no IO, never delivers. */
export function createDryRunTransport(channel: SupportedChannel): OutboundDeliveryTransport {
  return {
    channel,
    async send(request) {
      return simResult(request.correlationId, { status: 'simulated' });
    },
  };
}

/** Deterministic failure (retryable, no message accepted). */
export function createFailureTransport(channel: SupportedChannel): OutboundDeliveryTransport {
  return {
    channel,
    async send(request) {
      return simResult(request.correlationId, {
        status: 'failed',
        retryable: true,
        errorCode: 'provider_error:simulated',
        errorSummary: 'simulated_failure',
      });
    },
  };
}

/** Deterministic timeout — the uncertain case (do not blindly resend). */
export function createTimeoutTransport(channel: SupportedChannel): OutboundDeliveryTransport {
  return {
    channel,
    async send(request) {
      return simResult(request.correlationId, {
        status: 'timeout',
        retryable: true,
        errorCode: 'timeout:simulated',
        errorSummary: 'simulated_timeout',
      });
    },
  };
}

/** Deterministic "success" SIMULATION — sets a provider ref but never delivers
 * a customer-visible message; `simulated` stays true. */
export function createSuccessSimTransport(channel: SupportedChannel): OutboundDeliveryTransport {
  return {
    channel,
    async send(request, context) {
      return simResult(request.correlationId, {
        status: 'simulated',
        providerMessageRef: `sim-${request.idempotencyKey}`,
        acceptedAt: context.now.toISOString(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 6. External-success reconciliation
// ---------------------------------------------------------------------------

/**
 * Resolve an uncertain delivery attempt. A timeout/uncertain attempt must NEVER
 * be blindly resent — it goes to manual review unless a provider reference
 * proves acceptance.
 */
export function reconcileUncertainAttempt(
  request: DeliveryReconciliationRequest,
): DeliveryReconciliationResult {
  if (request.priorStatus === 'failed') {
    return { resolution: 'not_sent', safe: true, resend: false };
  }
  if (request.providerMessageRef) {
    // Provider accepted it (even if our app lost the response) → do not resend.
    return { resolution: 'confirmed_simulated', safe: true, resend: false };
  }
  if (request.priorStatus === 'timeout') {
    return { resolution: 'manual_review', safe: true, resend: false };
  }
  return { resolution: 'still_uncertain', safe: true, resend: false };
}

// ---------------------------------------------------------------------------
// 7. Aggregate safety summary
// ---------------------------------------------------------------------------

export interface LiveSendSafetySummary {
  total: number;
  allowed: number;
  /** Headline safety metric — MUST be 0 while the master switch is off. */
  delivered: number;
  safe: boolean;
}

export function summarizeLiveSendEvaluations(
  evaluations: LiveSendEvaluation[],
): LiveSendSafetySummary {
  const allowed = evaluations.filter((e) => e.allowed).length;
  return { total: evaluations.length, allowed, delivered: allowed, safe: allowed === 0 };
}
