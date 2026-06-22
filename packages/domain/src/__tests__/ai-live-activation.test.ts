import { describe, it, expect } from 'vitest';
import {
  evaluateLiveActivation,
  evaluateApprovalCompleteness,
  isApplicableMode,
  ACTIVATION_APPROVAL_ROLES,
  LIVE_ACTIVATION_BLOCKER_LABELS,
  SENDABLE_MODES,
  type LiveActivationInputs,
  type ActivationApproval,
  type LiveActivationBlocker,
} from '../ai-live-activation';

const REQUESTER = 'user-requester';

/** Three distinct non-requester approvers, one per required role — fully approved. */
const fullApprovals: ActivationApproval[] = [
  { role: 'product', approverId: 'user-pm', decision: 'approve' },
  { role: 'engineering', approverId: 'user-eng', decision: 'approve' },
  { role: 'legal', approverId: 'user-legal', decision: 'approve' },
];

/** The "best case" an operator can stage: every prerequisite satisfied. */
const operatorPerfect: LiveActivationInputs = {
  masterSwitchOn: true,
  hasPendingRequest: true,
  requestedMode: 'live_candidate',
  approvals: fullApprovals,
  requesterId: REQUESTER,
  killSwitchActive: false,
  withinEffectiveWindow: true,
  rolloutConfigured: true,
};

describe('approval completeness', () => {
  it('all required roles approved, no rejection, no self-approval → complete', () => {
    const c = evaluateApprovalCompleteness(fullApprovals, REQUESTER);
    expect(c.complete).toBe(true);
    expect(c.missingRoles).toEqual([]);
    expect(c.hasRejection).toBe(false);
    expect(c.requesterSelfApproved).toBe(false);
  });

  it('a missing role blocks completeness', () => {
    const c = evaluateApprovalCompleteness(fullApprovals.slice(0, 2), REQUESTER);
    expect(c.complete).toBe(false);
    expect(c.missingRoles).toContain('legal');
  });

  it('any rejection blocks completeness', () => {
    const c = evaluateApprovalCompleteness(
      [...fullApprovals, { role: 'legal', approverId: 'user-legal2', decision: 'reject' }],
      REQUESTER,
    );
    expect(c.hasRejection).toBe(true);
    expect(c.complete).toBe(false);
  });

  it('the requester approving their own request is flagged and blocks', () => {
    const c = evaluateApprovalCompleteness(
      [
        { role: 'product', approverId: REQUESTER, decision: 'approve' },
        { role: 'engineering', approverId: 'user-eng', decision: 'approve' },
        { role: 'legal', approverId: 'user-legal', decision: 'approve' },
      ],
      REQUESTER,
    );
    expect(c.requesterSelfApproved).toBe(true);
    expect(c.complete).toBe(false);
  });
});

describe('isApplicableMode / SENDABLE_MODES', () => {
  it('no current enum mode is sendable', () => {
    for (const m of ['disabled', 'shadow', 'copilot', 'live_candidate'] as const) {
      expect(isApplicableMode(m)).toBe(true);
    }
  });
  it('a hypothetical "live" mode is sendable (and thus not applicable)', () => {
    expect(SENDABLE_MODES.has('live')).toBe(true);
    expect(isApplicableMode('live')).toBe(false);
  });
});

describe('evaluateLiveActivation — headline safety invariant', () => {
  it('NEVER permits live sending even with a perfectly-approved request', () => {
    const d = evaluateLiveActivation(operatorPerfect);
    expect(d.liveSendingPermitted).toBe(false);
    expect(d.operatorReady).toBe(true); // operator side fully ready…
    expect(d.masterSwitchOn).toBe(false); // …but the master switch is off
    expect(d.blockers).toContain('master_switch_off');
    expect(d.applicableMode).toBe('live_candidate');
  });

  it('never permits live sending across an exhaustive prerequisite matrix', () => {
    const bools = [true, false];
    let checked = 0;
    for (const masterSwitchOn of bools)
      for (const hasPendingRequest of bools)
        for (const killSwitchActive of bools)
          for (const withinEffectiveWindow of bools)
            for (const rolloutConfigured of bools)
              for (const requestedMode of ['live_candidate', 'copilot'] as const)
                for (const approvals of [fullApprovals, fullApprovals.slice(0, 1), []]) {
                  const d = evaluateLiveActivation({
                    masterSwitchOn,
                    hasPendingRequest,
                    requestedMode,
                    approvals,
                    requesterId: REQUESTER,
                    killSwitchActive,
                    withinEffectiveWindow,
                    rolloutConfigured,
                  });
                  expect(d.liveSendingPermitted).toBe(false);
                  expect(d.masterSwitchOn).toBe(false); // constant ANDs to false
                  // applicableMode is never a sendable mode.
                  expect(SENDABLE_MODES.has(d.applicableMode)).toBe(false);
                  checked++;
                }
    // 2^5 booleans × 2 modes × 3 approval sets = 192.
    expect(checked).toBe(192);
  });

  it('clamps a sendable requested mode to live_candidate and flags it', () => {
    const d = evaluateLiveActivation({
      ...operatorPerfect,
      requestedMode: 'live' as never,
    });
    expect(d.blockers).toContain('mode_is_sendable');
    expect(d.applicableMode).toBe('live_candidate');
    expect(d.operatorReady).toBe(false);
  });

  it('surfaces each operational blocker', () => {
    expect(
      evaluateLiveActivation({ ...operatorPerfect, hasPendingRequest: false }).blockers,
    ).toContain('no_request');
    expect(
      evaluateLiveActivation({ ...operatorPerfect, killSwitchActive: true }).blockers,
    ).toContain('kill_switch_active');
    expect(
      evaluateLiveActivation({ ...operatorPerfect, withinEffectiveWindow: false }).blockers,
    ).toContain('outside_effective_window');
    expect(
      evaluateLiveActivation({ ...operatorPerfect, rolloutConfigured: false }).blockers,
    ).toContain('rollout_not_configured');
  });
});

describe('LIVE_ACTIVATION_BLOCKER_LABELS', () => {
  it('labels every blocker', () => {
    const all: LiveActivationBlocker[] = [
      'master_switch_off',
      'no_request',
      'request_not_pending',
      'approvals_incomplete',
      'request_rejected',
      'requester_self_approved',
      'mode_is_sendable',
      'kill_switch_active',
      'outside_effective_window',
      'rollout_not_configured',
    ];
    for (const b of all) expect(LIVE_ACTIVATION_BLOCKER_LABELS[b]).toBeTruthy();
    expect(ACTIVATION_APPROVAL_ROLES).toEqual(['product', 'engineering', 'legal']);
  });
});
