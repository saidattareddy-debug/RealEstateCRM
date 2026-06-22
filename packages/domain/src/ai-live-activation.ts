/**
 * Phase 5B.1 — live-send ACTIVATION GOVERNANCE (PURE, no IO).
 *
 * Phase 5B.0 modelled the per-message send path (`evaluateLiveSendGates`) and
 * proved one inbound message can never produce a delivery while the compile-time
 * `LIVE_SEND_MASTER_SWITCH` is `false`. This module models the layer ABOVE that:
 * the two-person governance workflow that would *enable a live-sending mode* for
 * a tenant/channel in the first place — request, multi-role approval, rollout
 * window, and kill switch.
 *
 * Two-key safety model (identical in spirit to `evaluateProviderActivation`):
 *
 *   1. OPERATOR key  — a fully-approved activation request (every required role
 *      approved, no rejection, the requester did not approve their own request),
 *      a non-sendable requested mode, the kill switch off, and a configured
 *      rollout window. Together these make `operatorReady` true.
 *
 *   2. ENGINEERING key — `LIVE_SEND_MASTER_SWITCH` (compile-time `false`), the
 *      same constant the per-message gate ANDs against.
 *
 * Headline invariant (proven by tests): `evaluateLiveActivation` can NEVER return
 * `liveSendingPermitted: true` while the master switch is `false` — regardless of
 * a perfectly-approved request. Governance + database state alone can never cause
 * automatic customer sending. The strongest mode an operator can APPLY today is
 * `live_candidate`, which the per-message gate still suppresses.
 */

import { LIVE_SEND_MASTER_SWITCH, type ResponderMode } from './ai-live-send';

/** Sign-off roles required for a two-person (here: three-role) activation. */
export const ACTIVATION_APPROVAL_ROLES = ['product', 'engineering', 'legal'] as const;
export type ActivationApprovalRole = (typeof ACTIVATION_APPROVAL_ROLES)[number];

/**
 * Modes that actually deliver to a customer. There are intentionally NONE in the
 * current enum (`disabled | shadow | copilot | live_candidate`) — `live_candidate`
 * still only produces suppressed/simulated outcomes. This set exists so that if a
 * future migration ever adds a real `live` mode, applying it is gated here too.
 */
export const SENDABLE_MODES: ReadonlySet<string> = new Set<string>(['live']);

/** A mode is safe to APPLY iff it is not a customer-sending mode. */
export function isApplicableMode(mode: ResponderMode | string): boolean {
  return !SENDABLE_MODES.has(mode);
}

export interface ActivationApproval {
  role: ActivationApprovalRole;
  approverId: string;
  decision: 'approve' | 'reject';
}

export interface ApprovalCompleteness {
  /** Roles with an explicit approve (and no later reject). */
  approvedRoles: ActivationApprovalRole[];
  /** Required roles still missing an approval. */
  missingRoles: ActivationApprovalRole[];
  /** Any explicit reject was recorded. */
  hasRejection: boolean;
  /** The requester approved their own request (integrity violation). */
  requesterSelfApproved: boolean;
  /** All required roles approved, no rejection, no self-approval. */
  complete: boolean;
}

/**
 * Reduce a set of approvals to completeness. A reject on any required role, or a
 * self-approval by the requester, makes the request not-complete. Pure.
 */
export function evaluateApprovalCompleteness(
  approvals: ActivationApproval[],
  requesterId: string,
  requiredRoles: readonly ActivationApprovalRole[] = ACTIVATION_APPROVAL_ROLES,
): ApprovalCompleteness {
  const approvedRoles = new Set<ActivationApprovalRole>();
  let hasRejection = false;
  let requesterSelfApproved = false;

  for (const a of approvals) {
    if (a.approverId === requesterId) requesterSelfApproved = true;
    if (a.decision === 'reject') hasRejection = true;
    else if (a.decision === 'approve' && requiredRoles.includes(a.role)) approvedRoles.add(a.role);
  }

  const missingRoles = requiredRoles.filter((r) => !approvedRoles.has(r));
  const complete = !hasRejection && !requesterSelfApproved && missingRoles.length === 0;

  return {
    approvedRoles: [...approvedRoles],
    missingRoles,
    hasRejection,
    requesterSelfApproved,
    complete,
  };
}

export type LiveActivationBlocker =
  | 'master_switch_off'
  | 'no_request'
  | 'request_not_pending'
  | 'approvals_incomplete'
  | 'request_rejected'
  | 'requester_self_approved'
  | 'mode_is_sendable'
  | 'kill_switch_active'
  | 'outside_effective_window'
  | 'rollout_not_configured';

export interface LiveActivationInputs {
  /** Caller's view of the master switch. ANDed with the compile-time constant. */
  masterSwitchOn: boolean;
  /** Is there a pending activation request? */
  hasPendingRequest: boolean;
  /** The mode the request asks to move to. */
  requestedMode: ResponderMode;
  /** The two-person/three-role approval state for the request. */
  approvals: ActivationApproval[];
  requesterId: string;
  requiredRoles?: readonly ActivationApprovalRole[];
  /** Operational guards on the channel settings. */
  killSwitchActive: boolean;
  withinEffectiveWindow: boolean;
  rolloutConfigured: boolean;
}

export interface LiveActivationDecision {
  /** The ONLY field that would gate real sending. ALWAYS false while the master switch is false. */
  liveSendingPermitted: boolean;
  /** All operator prerequisites satisfied (independent of the master switch). */
  operatorReady: boolean;
  /** The compile-time engineering key. */
  masterSwitchOn: boolean;
  /** The mode that may be APPLIED now (never a sendable mode). */
  applicableMode: ResponderMode;
  approvals: ApprovalCompleteness;
  blockers: LiveActivationBlocker[];
  summary: string;
}

/**
 * Decide whether a tenant/channel may move to a live-sending mode. Pure.
 *
 * `liveSendingPermitted = operatorReady && masterSwitchOn`. The master switch is a
 * compile-time `false`, so this is always `false` today — the safety guarantee.
 * `applicableMode` is what the activation service may actually write to
 * `responder_channel_settings.mode`: the requested mode if it is non-sendable,
 * else clamped to `live_candidate` (still suppressed by the per-message gate).
 */
export function evaluateLiveActivation(inputs: LiveActivationInputs): LiveActivationDecision {
  const completeness = evaluateApprovalCompleteness(
    inputs.approvals,
    inputs.requesterId,
    inputs.requiredRoles,
  );

  const blockers: LiveActivationBlocker[] = [];
  const masterSwitchOn = LIVE_SEND_MASTER_SWITCH && inputs.masterSwitchOn;
  if (!masterSwitchOn) blockers.push('master_switch_off');
  if (!inputs.hasPendingRequest) blockers.push('no_request');
  if (completeness.hasRejection) blockers.push('request_rejected');
  if (completeness.requesterSelfApproved) blockers.push('requester_self_approved');
  if (!completeness.complete) blockers.push('approvals_incomplete');
  if (SENDABLE_MODES.has(inputs.requestedMode)) blockers.push('mode_is_sendable');
  if (inputs.killSwitchActive) blockers.push('kill_switch_active');
  if (!inputs.withinEffectiveWindow) blockers.push('outside_effective_window');
  if (!inputs.rolloutConfigured) blockers.push('rollout_not_configured');

  const operatorReady =
    inputs.hasPendingRequest &&
    completeness.complete &&
    !SENDABLE_MODES.has(inputs.requestedMode) &&
    !inputs.killSwitchActive &&
    inputs.withinEffectiveWindow &&
    inputs.rolloutConfigured;

  // ANDed with the constant — governance can never override the engineering key.
  const liveSendingPermitted = operatorReady && masterSwitchOn;

  // The mode we may actually persist now: never a sendable mode.
  const applicableMode: ResponderMode = isApplicableMode(inputs.requestedMode)
    ? inputs.requestedMode
    : 'live_candidate';

  const summary = liveSendingPermitted
    ? 'Live sending permitted.'
    : !masterSwitchOn
      ? 'Live sending is disabled by the master switch; no configuration can enable it.'
      : `Live sending blocked — ${blockers.length} prerequisite(s) unmet.`;

  return {
    liveSendingPermitted,
    operatorReady,
    masterSwitchOn,
    applicableMode,
    approvals: completeness,
    blockers,
    summary,
  };
}

export const LIVE_ACTIVATION_BLOCKER_LABELS: Record<LiveActivationBlocker, string> = {
  master_switch_off: 'Live-send master switch is OFF (compile-time)',
  no_request: 'No pending activation request',
  request_not_pending: 'The activation request is not pending',
  approvals_incomplete: 'Required role approvals are incomplete',
  request_rejected: 'A required reviewer rejected the request',
  requester_self_approved: 'The requester approved their own request',
  mode_is_sendable: 'Requested mode would send to customers',
  kill_switch_active: 'The kill switch is active',
  outside_effective_window: 'Outside the configured effective window',
  rollout_not_configured: 'Rollout percentage / window not configured',
};
