/**
 * Phase 8 — Automation engine (PURE, no IO).
 *
 * Deterministically evaluates a workflow automation against a trigger event and a
 * snapshot of lead/context facts, producing a list of RESOLVED ACTIONS. The engine
 * never performs IO and never sends anything: it classifies each action as either
 * `internal` (safe internal mutation — task/stage/assignment/tag/note/internal
 * notification) or `customer_send` (would message a customer). A `customer_send`
 * action ALWAYS carries `willSend: false` here, because real delivery is gated by
 * the compile-time `LIVE_SEND_MASTER_SWITCH` (Phase 5B.1) and a live channel
 * (Phase 7B). The server routes such actions through the suppressed outbox.
 *
 * Phase 8 IS the explicitly-approved automation phase: automatic internal
 * mutations (stage/assignment/task) that earlier phases deferred are permitted
 * here. Customer SENDING remains impossible by construction.
 */

import { LIVE_SEND_MASTER_SWITCH } from './ai-live-send';

export const AUTOMATION_TRIGGERS = [
  'lead_created',
  'lead_stage_changed',
  'lead_score_changed',
  'conversation_inbound',
  'conversation_idle',
  'visit_scheduled',
  'visit_completed',
  'visit_no_show',
  'task_overdue',
  'time_schedule',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'exists',
  'not_exists',
  'changed',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface AutomationCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface ConditionGroup {
  combinator: 'and' | 'or';
  conditions: AutomationCondition[];
  /** Optional nested groups (one level of nesting is enough for the editor). */
  groups?: ConditionGroup[];
}

export const ACTION_TYPES = [
  // internal-safe
  'create_task',
  'change_stage',
  'assign_lead',
  'add_tag',
  'add_note',
  'notify_user',
  'enroll_sequence',
  'unenroll_sequence',
  // customer-send (suppressed while the master switch is off)
  'send_whatsapp_template',
  'send_email',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const CUSTOMER_SEND_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'send_whatsapp_template',
  'send_email',
]);

export function isCustomerSendAction(type: ActionType): boolean {
  return CUSTOMER_SEND_ACTIONS.has(type);
}

export interface AutomationAction {
  type: ActionType;
  /** Action-specific parameters (stageId, assigneeId, taskTitle, templateId, …). */
  params?: Record<string, unknown>;
}

export interface AutomationDefinition {
  id: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  conditionGroup?: ConditionGroup | null;
  actions: AutomationAction[];
  /** Optional max executions per lead (anti-loop). */
  maxRunsPerLead?: number | null;
}

export interface AutomationEventContext {
  trigger: AutomationTrigger;
  /** Flattened, comparable facts about the lead/conversation/visit at event time. */
  facts: Record<string, unknown>;
  /** Fields that changed in this event (for the `changed` operator). */
  changedFields?: string[];
  /** How many times this automation has already run for this lead. */
  priorRunsForLead?: number;
}

export interface ResolvedAction {
  type: ActionType;
  params: Record<string, unknown>;
  category: 'internal' | 'customer_send';
  /** ALWAYS false for customer_send while the master switch is off. */
  willSend: boolean;
  /** Why this action will not actually deliver (customer_send only). */
  suppressedReason?: string;
}

export interface AutomationDecision {
  automationId: string;
  matched: boolean;
  /** Reason the automation did not run (when not matched). */
  skippedReason: null | 'disabled' | 'trigger_mismatch' | 'conditions_unmet' | 'max_runs_reached';
  actions: ResolvedAction[];
}

function compare(
  op: ConditionOperator,
  actual: unknown,
  expected: unknown,
  changed: boolean,
): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'changed':
      return changed;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected);
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      );
    default:
      return false;
  }
}

function evalCondition(c: AutomationCondition, ctx: AutomationEventContext): boolean {
  const changed = (ctx.changedFields ?? []).includes(c.field);
  return compare(c.operator, ctx.facts[c.field], c.value, changed);
}

function evalGroup(group: ConditionGroup, ctx: AutomationEventContext): boolean {
  const own = group.conditions.map((c) => evalCondition(c, ctx));
  const nested = (group.groups ?? []).map((g) => evalGroup(g, ctx));
  const all = [...own, ...nested];
  if (all.length === 0) return true; // empty group = always matches
  return group.combinator === 'and' ? all.every(Boolean) : all.some(Boolean);
}

/**
 * Decide whether an automation runs for an event, and resolve its actions. Pure.
 * Customer-send actions are returned but flagged `willSend: false` (master switch).
 */
export function evaluateAutomation(
  def: AutomationDefinition,
  ctx: AutomationEventContext,
): AutomationDecision {
  const base: Omit<AutomationDecision, 'matched' | 'skippedReason' | 'actions'> = {
    automationId: def.id,
  };
  if (!def.enabled) return { ...base, matched: false, skippedReason: 'disabled', actions: [] };
  if (def.trigger !== ctx.trigger)
    return { ...base, matched: false, skippedReason: 'trigger_mismatch', actions: [] };
  if (def.maxRunsPerLead != null && (ctx.priorRunsForLead ?? 0) >= def.maxRunsPerLead)
    return { ...base, matched: false, skippedReason: 'max_runs_reached', actions: [] };
  if (def.conditionGroup && !evalGroup(def.conditionGroup, ctx))
    return { ...base, matched: false, skippedReason: 'conditions_unmet', actions: [] };

  const actions: ResolvedAction[] = def.actions.map((a) => {
    const isSend = isCustomerSendAction(a.type);
    // ANDed with the compile-time constant — never sends while it is false.
    const willSend = isSend && LIVE_SEND_MASTER_SWITCH;
    return {
      type: a.type,
      params: a.params ?? {},
      category: isSend ? 'customer_send' : 'internal',
      willSend,
      ...(isSend ? { suppressedReason: willSend ? undefined : 'live_send_master_switch_off' } : {}),
    };
  });

  return { ...base, matched: true, skippedReason: null, actions };
}

/** Summary used by tests/observability: how many actions would actually send. */
export function summarizeAutomationActions(decisions: AutomationDecision[]): {
  total: number;
  customerSend: number;
  wouldSend: number;
  safe: boolean;
} {
  let total = 0;
  let customerSend = 0;
  let wouldSend = 0;
  for (const d of decisions)
    for (const a of d.actions) {
      total++;
      if (a.category === 'customer_send') customerSend++;
      if (a.willSend) wouldSend++;
    }
  return { total, customerSend, wouldSend, safe: wouldSend === 0 };
}
