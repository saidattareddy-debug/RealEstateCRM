import { describe, it, expect } from 'vitest';
import {
  canExecuteAutomatedReply,
  evaluateAiExecution,
  resumeTargetMode,
  AI_RESPONDER_INSTALLED,
  type AiExecutionContext,
  type AiOperatingLevel,
  type AutomatedReplyContext,
} from '../ai-guard';

const fullyEnabled: AutomatedReplyContext = {
  tenantId: 't1',
  conversationId: 'c1',
  operatingMode: 'ai',
  takeoverActive: false,
  lifecycle: 'open',
  dncBlocked: false,
  consentWithdrawn: false,
  tenantAiEnabled: true,
  projectAiApproved: true,
  modelConfigured: true,
  knowledgeApproved: true,
};

describe('canExecuteAutomatedReply', () => {
  it('the responder is NOT installed before Phase 5', () => {
    expect(AI_RESPONDER_INSTALLED).toBe(false);
  });

  it('denies even when every flag is enabled (no responder installed)', () => {
    const d = canExecuteAutomatedReply(fullyEnabled);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('no_responder_installed');
    // Decision still reports each gate honestly.
    expect(d.featureStatus).toBe('enabled');
    expect(d.modelStatus).toBe('configured');
    expect(d.knowledgeStatus).toBe('approved');
  });

  it('a database flag alone cannot activate AI', () => {
    // Even with operating_mode ai + tenant enabled, it stays denied.
    const d = canExecuteAutomatedReply({ ...fullyEnabled });
    expect(d.allowed).toBe(false);
  });

  it('reports human takeover and DNC in the decision regardless of denial order', () => {
    const d = canExecuteAutomatedReply({
      ...fullyEnabled,
      takeoverActive: true,
      dncBlocked: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.takeoverState).toBe(true);
    expect(d.dncState).toBe('blocked');
  });

  it('is denied for non-open lifecycles', () => {
    for (const lc of ['paused', 'resolved', 'closed', 'spam', 'archived'] as const) {
      expect(canExecuteAutomatedReply({ ...fullyEnabled, lifecycle: lc }).allowed).toBe(false);
    }
  });
});

describe('canExecuteAutomatedReply — automatic level (Phase 5A)', () => {
  it('an explicit automatic request is denied with the Phase-5B reason', () => {
    const d = canExecuteAutomatedReply({ ...fullyEnabled, requestedLevel: 'automatic' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('phase_5b_automatic_responder_not_enabled');
  });

  it('forged enable flags cannot bypass the automatic denial', () => {
    // Every gate forced "open"; still denied because automatic is impossible.
    const d = canExecuteAutomatedReply({
      ...fullyEnabled,
      requestedLevel: 'automatic',
      takeoverActive: false,
      dncBlocked: false,
      consentWithdrawn: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('phase_5b_automatic_responder_not_enabled');
  });
});

const execBase: AiExecutionContext = { ...fullyEnabled, level: 'copilot' };

describe('evaluateAiExecution (Phase 5A operating levels)', () => {
  it('NEVER allows an automatic customer send, for any level or inputs', () => {
    const levels: AiOperatingLevel[] = ['disabled', 'shadow', 'copilot', 'automatic'];
    for (const level of levels) {
      // Force every "enable" signal on — a forged fully-open context.
      const d = evaluateAiExecution({
        ...execBase,
        level,
        platformAiEnabled: true,
        channelPolicyAllows: true,
        retrievalSufficient: true,
        conflictsPresent: false,
        staleDynamicData: false,
        processingLockHeld: false,
        dailyLimitReached: false,
        providerAvailable: true,
      });
      expect(d.maySendAutomatically).toBe(false);
    }
  });

  it('automatic is denied with the canonical reason', () => {
    const d = evaluateAiExecution({ ...execBase, level: 'automatic' });
    expect(d.mayGenerateDraft).toBe(false);
    expect(d.maySendAutomatically).toBe(false);
    expect(d.reason).toBe('phase_5b_automatic_responder_not_enabled');
  });

  it('disabled generates nothing', () => {
    const d = evaluateAiExecution({ ...execBase, level: 'disabled' });
    expect(d.mayGenerateDraft).toBe(false);
    expect(d.blockers).toContain('level_disabled');
  });

  it('copilot may generate a draft when every generation gate passes', () => {
    const d = evaluateAiExecution({
      ...execBase,
      level: 'copilot',
      platformAiEnabled: true,
      channelPolicyAllows: true,
      providerAvailable: true,
    });
    expect(d.mayGenerateDraft).toBe(true);
    expect(d.maySendAutomatically).toBe(false);
    expect(d.blockers).toEqual([]);
  });

  it('shadow draft generation is blocked when a generation gate fails', () => {
    expect(
      evaluateAiExecution({ ...execBase, level: 'shadow', platformAiEnabled: false })
        .mayGenerateDraft,
    ).toBe(false);
    expect(
      evaluateAiExecution({ ...execBase, level: 'shadow', dailyLimitReached: true }).blockers,
    ).toContain('daily_limit_reached');
    expect(
      evaluateAiExecution({ ...execBase, level: 'shadow', processingLockHeld: true }).blockers,
    ).toContain('processing_locked');
    expect(
      evaluateAiExecution({ ...execBase, level: 'copilot', knowledgeApproved: false }).blockers,
    ).toContain('knowledge_not_approved');
  });
});

describe('resumeTargetMode', () => {
  it('never returns ai', () => {
    expect(resumeTargetMode('human')).toBe('human');
    expect(resumeTargetMode('paused')).toBe('paused');
    // @ts-expect-error guard against accidental 'ai'
    expect(resumeTargetMode('ai')).not.toBe('ai');
  });
});
