import { describe, it, expect } from 'vitest';
import {
  decideFollowUpStep,
  isQuietHours,
  summarizeFollowUps,
  type FollowUpSequence,
  type FollowUpEnrollment,
  type FollowUpContext,
} from '../followup';

const seq = (over: Partial<FollowUpSequence> = {}): FollowUpSequence => ({
  id: 'seq1',
  enabled: true,
  stopOnReply: true,
  quietHoursStartHour: 20,
  quietHoursEndHour: 9,
  steps: [
    { index: 0, delayHours: 0, channel: 'whatsapp', templateId: 't0' },
    { index: 1, delayHours: 24, channel: 'whatsapp', templateId: 't1' },
    { index: 2, delayHours: 72, channel: 'email', templateId: 't2', onlyScoreCategories: ['hot'] },
  ],
  ...over,
});

const enrollment = (over: Partial<FollowUpEnrollment> = {}): FollowUpEnrollment => ({
  id: 'e1',
  sequenceId: 'seq1',
  leadId: 'l1',
  currentStepIndex: 0,
  enrolledAt: '2026-06-22T06:00:00Z',
  nextStepDueAt: '2026-06-22T06:00:00Z',
  status: 'active',
  enrolledScoreCategory: 'hot',
  ...over,
});

// 12:00 UTC = 17:30 IST → outside quiet hours.
const ctx = (over: Partial<FollowUpContext> = {}): FollowUpContext => ({
  now: new Date('2026-06-22T06:30:00Z'),
  tzOffsetMinutes: 330,
  dncActive: false,
  consentRevoked: false,
  humanTakeover: false,
  leadConverted: false,
  leadLost: false,
  optedOutOfSequence: false,
  customerReplied: false,
  currentScoreCategory: 'hot',
  ...over,
});

describe('decideFollowUpStep — stop conditions (priority order)', () => {
  const cases: [keyof FollowUpContext, unknown, string][] = [
    ['dncActive', true, 'dnc_active'],
    ['consentRevoked', true, 'consent_revoked'],
    ['humanTakeover', true, 'human_takeover'],
    ['leadConverted', true, 'lead_converted'],
    ['leadLost', true, 'lead_lost'],
    ['optedOutOfSequence', true, 'opted_out'],
    ['customerReplied', true, 'customer_replied'],
  ];
  for (const [field, val, reason] of cases) {
    it(`stops on ${reason}`, () => {
      const d = decideFollowUpStep(seq(), enrollment(), ctx({ [field]: val } as never));
      expect(d.outcome).toBe('stop');
      expect(d.stopReason).toBe(reason);
      expect(d.willSend).toBe(false);
    });
  }

  it('stops when sequence disabled', () => {
    const d = decideFollowUpStep(seq({ enabled: false }), enrollment(), ctx());
    expect(d.stopReason).toBe('sequence_disabled');
  });

  it('stops past the last step', () => {
    const d = decideFollowUpStep(seq(), enrollment({ currentStepIndex: 3 }), ctx());
    expect(d.outcome).toBe('stop');
    expect(d.stopReason).toBe('max_steps_reached');
  });
});

describe('decideFollowUpStep — scheduling', () => {
  it('waits when the step is not due', () => {
    const d = decideFollowUpStep(
      seq(),
      enrollment({ nextStepDueAt: '2026-06-23T06:00:00Z' }),
      ctx(),
    );
    expect(d.outcome).toBe('wait');
  });

  it('SENDS (suppressed) when due + eligible + outside quiet hours, with whySent', () => {
    const d = decideFollowUpStep(seq(), enrollment(), ctx());
    expect(d.outcome).toBe('send');
    expect(d.willSend).toBe(false); // master switch off
    expect(d.suppressedReason).toBe('live_send_master_switch_off');
    expect(d.whySent).toMatchObject({
      sequenceId: 'seq1',
      stepIndex: 0,
      channel: 'whatsapp',
      enrolledScoreCategory: 'hot',
      reason: 'scheduled_followup_step',
    });
    expect(d.nextStepIndex).toBe(1);
  });

  it('defers during quiet hours (not a stop)', () => {
    // 18:00 UTC = 23:30 IST → quiet hours.
    const d = decideFollowUpStep(
      seq(),
      enrollment(),
      ctx({ now: new Date('2026-06-22T18:00:00Z') }),
    );
    expect(d.outcome).toBe('defer_quiet_hours');
    expect(d.nextEligibleAt).not.toBeNull();
    // The deferred instant is outside quiet hours.
    expect(isQuietHours(new Date(d.nextEligibleAt!), 330, 20, 9)).toBe(false);
  });

  it('skips a score-gated step the lead is not eligible for', () => {
    const d = decideFollowUpStep(
      seq(),
      enrollment({ currentStepIndex: 2 }),
      ctx({ currentScoreCategory: 'cold' }),
    );
    expect(d.outcome).toBe('advance_skip');
    expect(d.nextStepIndex).toBe(3);
  });
});

describe('isQuietHours', () => {
  it('handles the overnight window 20→9 (IST)', () => {
    expect(isQuietHours(new Date('2026-06-22T18:00:00Z'), 330, 20, 9)).toBe(true); // 23:30 IST
    expect(isQuietHours(new Date('2026-06-22T01:00:00Z'), 330, 20, 9)).toBe(true); // 06:30 IST
    expect(isQuietHours(new Date('2026-06-22T06:30:00Z'), 330, 20, 9)).toBe(false); // 12:00 IST
  });
});

describe('SAFETY — no follow-up ever actually sends', () => {
  it('summarize reports zero would-send', () => {
    const decisions = [
      decideFollowUpStep(seq(), enrollment(), ctx()),
      decideFollowUpStep(seq(), enrollment(), ctx({ now: new Date('2026-06-22T18:00:00Z') })),
      decideFollowUpStep(seq(), enrollment(), ctx({ dncActive: true })),
    ];
    const s = summarizeFollowUps(decisions);
    expect(s.wouldSend).toBe(0);
    expect(s.safe).toBe(true);
  });
});
