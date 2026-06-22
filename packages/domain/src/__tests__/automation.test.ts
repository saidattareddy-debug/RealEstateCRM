import { describe, it, expect } from 'vitest';
import {
  evaluateAutomation,
  summarizeAutomationActions,
  isCustomerSendAction,
  type AutomationDefinition,
  type AutomationEventContext,
} from '../automation';

const def = (over: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
  id: 'a1',
  trigger: 'lead_score_changed',
  enabled: true,
  conditionGroup: null,
  actions: [{ type: 'create_task', params: { title: 'Call back' } }],
  maxRunsPerLead: null,
  ...over,
});

const ctx = (over: Partial<AutomationEventContext> = {}): AutomationEventContext => ({
  trigger: 'lead_score_changed',
  facts: { scoreCategory: 'hot', score: 80 },
  changedFields: ['score', 'scoreCategory'],
  priorRunsForLead: 0,
  ...over,
});

describe('evaluateAutomation — gating', () => {
  it('skips a disabled automation', () => {
    const d = evaluateAutomation(def({ enabled: false }), ctx());
    expect(d.matched).toBe(false);
    expect(d.skippedReason).toBe('disabled');
  });

  it('skips on trigger mismatch', () => {
    const d = evaluateAutomation(def(), ctx({ trigger: 'lead_created' }));
    expect(d.matched).toBe(false);
    expect(d.skippedReason).toBe('trigger_mismatch');
  });

  it('skips when max runs per lead reached', () => {
    const d = evaluateAutomation(def({ maxRunsPerLead: 2 }), ctx({ priorRunsForLead: 2 }));
    expect(d.skippedReason).toBe('max_runs_reached');
  });

  it('matches with no conditions', () => {
    const d = evaluateAutomation(def(), ctx());
    expect(d.matched).toBe(true);
    expect(d.actions).toHaveLength(1);
  });
});

describe('evaluateAutomation — conditions', () => {
  it('AND group: all must pass', () => {
    const automation = def({
      conditionGroup: {
        combinator: 'and',
        conditions: [
          { field: 'scoreCategory', operator: 'eq', value: 'hot' },
          { field: 'score', operator: 'gte', value: 75 },
        ],
      },
    });
    expect(evaluateAutomation(automation, ctx()).matched).toBe(true);
    expect(
      evaluateAutomation(automation, ctx({ facts: { scoreCategory: 'warm', score: 50 } })).matched,
    ).toBe(false);
  });

  it('OR group + changed operator', () => {
    const automation = def({
      conditionGroup: {
        combinator: 'or',
        conditions: [
          { field: 'score', operator: 'changed' },
          { field: 'scoreCategory', operator: 'eq', value: 'cold' },
        ],
      },
    });
    expect(evaluateAutomation(automation, ctx()).matched).toBe(true); // score changed
    expect(
      evaluateAutomation(
        automation,
        ctx({ changedFields: [], facts: { scoreCategory: 'warm', score: 50 } }),
      ).matched,
    ).toBe(false);
  });

  it('in / not_in / contains operators', () => {
    const automation = def({
      conditionGroup: {
        combinator: 'and',
        conditions: [{ field: 'source', operator: 'in', value: ['portal', 'meta'] }],
      },
    });
    expect(evaluateAutomation(automation, ctx({ facts: { source: 'portal' } })).matched).toBe(true);
    expect(evaluateAutomation(automation, ctx({ facts: { source: 'website' } })).matched).toBe(
      false,
    );
  });
});

describe('evaluateAutomation — SAFETY: customer-send never sends', () => {
  it('classifies send actions and never sets willSend true', () => {
    const automation = def({
      actions: [
        { type: 'change_stage', params: { stageId: 's2' } },
        { type: 'send_whatsapp_template', params: { templateId: 't1' } },
        { type: 'send_email', params: { templateId: 'e1' } },
      ],
    });
    const d = evaluateAutomation(automation, ctx());
    const send = d.actions.filter((a) => a.category === 'customer_send');
    expect(send).toHaveLength(2);
    for (const a of send) {
      expect(a.willSend).toBe(false);
      expect(a.suppressedReason).toBe('live_send_master_switch_off');
    }
    const internal = d.actions.find((a) => a.type === 'change_stage');
    expect(internal?.category).toBe('internal');
  });

  it('summary reports zero would-send across a batch', () => {
    const automation = def({
      actions: [
        { type: 'send_whatsapp_template' },
        { type: 'send_email' },
        { type: 'create_task' },
      ],
    });
    const s = summarizeAutomationActions([
      evaluateAutomation(automation, ctx()),
      evaluateAutomation(automation, ctx()),
    ]);
    expect(s.customerSend).toBe(4);
    expect(s.wouldSend).toBe(0);
    expect(s.safe).toBe(true);
  });

  it('isCustomerSendAction is correct', () => {
    expect(isCustomerSendAction('send_whatsapp_template')).toBe(true);
    expect(isCustomerSendAction('send_email')).toBe(true);
    expect(isCustomerSendAction('create_task')).toBe(false);
    expect(isCustomerSendAction('change_stage')).toBe(false);
  });
});
