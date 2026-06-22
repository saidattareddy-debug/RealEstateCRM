/**
 * Phase 8 — Score-aware follow-up sequences (PURE, no IO).
 *
 * A sequence is an ordered list of steps (delay + channel + template). A lead is
 * enrolled, and `decideFollowUpStep` is ticked to decide what happens next:
 * advance, send the due step (SUPPRESSED — never real), defer for quiet hours, or
 * STOP. Every stop condition required by the spec is enforced, and every produced
 * send carries a `whySent` provenance object.
 *
 * Safety: a "send" outcome NEVER means a real customer message. The produced
 * action is a candidate with `willSend: false` while the compile-time
 * `LIVE_SEND_MASTER_SWITCH` is `false` (Phase 5B.1) — delivery is impossible by
 * construction. The server records the candidate through the suppressed outbox.
 */

import { LIVE_SEND_MASTER_SWITCH } from './ai-live-send';

export type FollowUpChannel = 'whatsapp' | 'email' | 'task_reminder';

export interface FollowUpStep {
  index: number;
  /** Delay from enrollment (or from the previous step) in hours. */
  delayHours: number;
  channel: FollowUpChannel;
  templateId: string | null;
  /** Only run this step when the lead is in one of these score categories. */
  onlyScoreCategories?: ('hot' | 'warm' | 'cold')[];
}

export interface FollowUpSequence {
  id: string;
  enabled: boolean;
  steps: FollowUpStep[];
  /** Stop the sequence if the customer replies. */
  stopOnReply: boolean;
  /** Tenant-local quiet-hours window (defaults 20:00–09:00). */
  quietHoursStartHour: number;
  quietHoursEndHour: number;
}

export interface FollowUpEnrollment {
  id: string;
  sequenceId: string;
  leadId: string;
  currentStepIndex: number;
  enrolledAt: string;
  /** When the current step becomes due. */
  nextStepDueAt: string;
  status: 'active' | 'completed' | 'stopped';
  /** Score category captured at enrollment (provenance). */
  enrolledScoreCategory: 'hot' | 'warm' | 'cold' | 'unscored';
}

export interface FollowUpContext {
  now: Date;
  /** Tenant-local UTC offset in minutes (e.g. Asia/Kolkata = +330). */
  tzOffsetMinutes: number;
  dncActive: boolean;
  consentRevoked: boolean;
  humanTakeover: boolean;
  leadConverted: boolean;
  leadLost: boolean;
  optedOutOfSequence: boolean;
  customerReplied: boolean;
  /** Current score category (for score-gated steps). */
  currentScoreCategory: 'hot' | 'warm' | 'cold' | 'unscored';
}

export type FollowUpStopReason =
  | 'sequence_disabled'
  | 'dnc_active'
  | 'consent_revoked'
  | 'human_takeover'
  | 'lead_converted'
  | 'lead_lost'
  | 'opted_out'
  | 'customer_replied'
  | 'max_steps_reached';

export type FollowUpOutcome = 'send' | 'advance_skip' | 'defer_quiet_hours' | 'wait' | 'stop';

export interface WhySent {
  sequenceId: string;
  stepIndex: number;
  channel: FollowUpChannel;
  templateId: string | null;
  enrolledScoreCategory: string;
  reason: 'scheduled_followup_step';
}

export interface FollowUpDecision {
  outcome: FollowUpOutcome;
  stopReason: FollowUpStopReason | null;
  /** For `send`: the (suppressed) candidate provenance. */
  whySent: WhySent | null;
  /** ALWAYS false while the master switch is off. */
  willSend: boolean;
  suppressedReason: string | null;
  /** For `defer_quiet_hours`: when the step may next run (tenant-local aware). */
  nextEligibleAt: string | null;
  /** For `advance_skip`/`wait`: the resolved next step index. */
  nextStepIndex: number;
}

/** Hard stop conditions, in priority order. The first hit wins. */
function hardStop(seq: FollowUpSequence, ctx: FollowUpContext): FollowUpStopReason | null {
  if (!seq.enabled) return 'sequence_disabled';
  if (ctx.dncActive) return 'dnc_active';
  if (ctx.consentRevoked) return 'consent_revoked';
  if (ctx.humanTakeover) return 'human_takeover';
  if (ctx.leadConverted) return 'lead_converted';
  if (ctx.leadLost) return 'lead_lost';
  if (ctx.optedOutOfSequence) return 'opted_out';
  if (seq.stopOnReply && ctx.customerReplied) return 'customer_replied';
  return null;
}

/** True when the tenant-local hour falls inside the quiet-hours window. */
export function isQuietHours(
  now: Date,
  tzOffsetMinutes: number,
  startHour: number,
  endHour: number,
): boolean {
  const localMs = now.getTime() + tzOffsetMinutes * 60_000;
  const localHour = new Date(localMs).getUTCHours();
  // Overnight window (e.g. 20→9) wraps midnight.
  if (startHour > endHour) return localHour >= startHour || localHour < endHour;
  return localHour >= startHour && localHour < endHour;
}

/** Next instant at/after `now` that is outside quiet hours (tenant-local). */
function nextAllowed(now: Date, tzOffsetMinutes: number, startHour: number, endHour: number): Date {
  const d = new Date(now.getTime());
  for (let i = 0; i < 48; i++) {
    if (!isQuietHours(d, tzOffsetMinutes, startHour, endHour)) return d;
    d.setTime(d.getTime() + 60 * 60_000); // advance an hour
  }
  return d;
}

/**
 * Decide the next follow-up action for an enrollment. Pure + deterministic.
 * Never produces a real send.
 */
export function decideFollowUpStep(
  seq: FollowUpSequence,
  enrollment: FollowUpEnrollment,
  ctx: FollowUpContext,
): FollowUpDecision {
  const base: FollowUpDecision = {
    outcome: 'wait',
    stopReason: null,
    whySent: null,
    willSend: false,
    suppressedReason: null,
    nextEligibleAt: null,
    nextStepIndex: enrollment.currentStepIndex,
  };

  const stop = hardStop(seq, ctx);
  if (stop) return { ...base, outcome: 'stop', stopReason: stop };

  // Past the last step → completed (treated as a benign stop with no reason).
  if (enrollment.currentStepIndex >= seq.steps.length)
    return { ...base, outcome: 'stop', stopReason: 'max_steps_reached' };

  const step = seq.steps[enrollment.currentStepIndex];
  if (!step) return { ...base, outcome: 'stop', stopReason: 'max_steps_reached' };

  // Not due yet.
  if (ctx.now.getTime() < new Date(enrollment.nextStepDueAt).getTime()) {
    return { ...base, outcome: 'wait' };
  }

  // Score-gating: if this step is restricted to categories the lead is not in,
  // skip it (advance) rather than send.
  if (
    step.onlyScoreCategories &&
    step.onlyScoreCategories.length > 0 &&
    (ctx.currentScoreCategory === 'unscored' ||
      !step.onlyScoreCategories.includes(ctx.currentScoreCategory))
  ) {
    return { ...base, outcome: 'advance_skip', nextStepIndex: enrollment.currentStepIndex + 1 };
  }

  // Quiet hours: defer (not stop) to the next allowed instant.
  if (isQuietHours(ctx.now, ctx.tzOffsetMinutes, seq.quietHoursStartHour, seq.quietHoursEndHour)) {
    const next = nextAllowed(
      ctx.now,
      ctx.tzOffsetMinutes,
      seq.quietHoursStartHour,
      seq.quietHoursEndHour,
    );
    return { ...base, outcome: 'defer_quiet_hours', nextEligibleAt: next.toISOString() };
  }

  // Due, eligible, outside quiet hours → SEND (suppressed) with provenance.
  const willSend = LIVE_SEND_MASTER_SWITCH; // false → never sends
  return {
    ...base,
    outcome: 'send',
    willSend,
    suppressedReason: willSend ? null : 'live_send_master_switch_off',
    nextStepIndex: enrollment.currentStepIndex + 1,
    whySent: {
      sequenceId: seq.id,
      stepIndex: step.index,
      channel: step.channel,
      templateId: step.templateId,
      enrolledScoreCategory: enrollment.enrolledScoreCategory,
      reason: 'scheduled_followup_step',
    },
  };
}

/** Aggregate safety check across many decisions (tests/observability). */
export function summarizeFollowUps(decisions: FollowUpDecision[]): {
  sends: number;
  wouldSend: number;
  stops: number;
  safe: boolean;
} {
  let sends = 0;
  let wouldSend = 0;
  let stops = 0;
  for (const d of decisions) {
    if (d.outcome === 'send') sends++;
    if (d.willSend) wouldSend++;
    if (d.outcome === 'stop') stops++;
  }
  return { sends, wouldSend, stops, safe: wouldSend === 0 };
}
