import 'server-only';
import {
  evaluateAutomation,
  isCustomerSendAction,
  ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  type AutomationDefinition,
  type AutomationTrigger,
  type ActionType,
  type ConditionGroup,
  type ResolvedAction,
} from '@re/domain';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 8 — Workflow automation service.
 *
 * Loads automations, evaluates them through the PURE `evaluateAutomation`
 * engine, and records `automation_runs` + `automation_run_actions`. Internal
 * actions (task/stage/assignment/tag/note/notify/enroll) MAY perform real
 * mutations — Phase 8 is the explicitly-approved automation phase — but each is
 * guarded by the lead being visible under the caller's RLS. `customer_send`
 * actions are RECORDED as suppressed (`will_send=false`,
 * `suppressed_reason='live_send_master_switch_off'`); the DB CHECK independently
 * forbids `will_send=true`, so a delivered automatic customer message can never
 * even be written.
 */

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ServiceResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface AutomationActionInput {
  type: ActionType;
  params?: Record<string, unknown>;
}

export interface AutomationSummary {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  maxRunsPerLead: number | null;
  lastRunAt: string | null;
}

interface AutomationActionRow {
  id: string;
  ordinal: number;
  action_type: string;
  params: Record<string, unknown> | null;
}

export interface AutomationDetail {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  conditionGroup: ConditionGroup | null;
  maxRunsPerLead: number | null;
  actions: AutomationActionRow[];
}

/** List automations for the active tenant (RLS-scoped). */
export async function listAutomations(
  supabase: DB,
  tenantId: string,
): Promise<AutomationSummary[]> {
  const { data } = await supabase
    .from('automations')
    .select('id, name, trigger, enabled, max_runs_per_lead')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  const rows = (data ?? []) as {
    id: string;
    name: string;
    trigger: string;
    enabled: boolean;
    max_runs_per_lead: number | null;
  }[];
  if (rows.length === 0) return [];

  // Latest run per automation (best-effort; RLS-scoped).
  const ids = rows.map((r) => r.id);
  const { data: runs } = await supabase
    .from('automation_runs')
    .select('automation_id, created_at')
    .eq('tenant_id', tenantId)
    .in('automation_id', ids)
    .order('created_at', { ascending: false });
  const lastRun = new Map<string, string>();
  for (const r of (runs ?? []) as { automation_id: string; created_at: string }[]) {
    if (!lastRun.has(r.automation_id)) lastRun.set(r.automation_id, r.created_at);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger as AutomationTrigger,
    enabled: r.enabled,
    maxRunsPerLead: r.max_runs_per_lead,
    lastRunAt: lastRun.get(r.id) ?? null,
  }));
}

/** Load one automation with its ordered actions (RLS-scoped). */
export async function getAutomation(
  supabase: DB,
  tenantId: string,
  automationId: string,
): Promise<AutomationDetail | null> {
  const { data: a } = await supabase
    .from('automations')
    .select('id, name, trigger, enabled, condition_group, max_runs_per_lead')
    .eq('tenant_id', tenantId)
    .eq('id', automationId)
    .maybeSingle();
  if (!a) return null;

  const { data: actions } = await supabase
    .from('automation_actions')
    .select('id, ordinal, action_type, params')
    .eq('tenant_id', tenantId)
    .eq('automation_id', automationId)
    .order('ordinal', { ascending: true });

  return {
    id: a.id as string,
    name: a.name as string,
    trigger: a.trigger as AutomationTrigger,
    enabled: a.enabled as boolean,
    conditionGroup: (a.condition_group as ConditionGroup | null) ?? null,
    maxRunsPerLead: (a.max_runs_per_lead as number | null) ?? null,
    actions: (actions ?? []) as AutomationActionRow[],
  };
}

export interface CreateAutomationInput {
  tenantId: string;
  actorUserId: string;
  name: string;
  trigger: AutomationTrigger;
}

/** Create a new (disabled) automation. */
export async function createAutomation(
  supabase: DB,
  input: CreateAutomationInput,
): Promise<ServiceResult> {
  if (!AUTOMATION_TRIGGERS.includes(input.trigger)) return { ok: false, error: 'invalid_trigger' };
  const { data, error } = await supabase
    .from('automations')
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      trigger: input.trigger,
      enabled: false,
      created_by: input.actorUserId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'create_failed' };

  await writeAudit({
    action: 'AUTOMATION_CREATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'automation',
    entityId: data.id as string,
    metadata: { name: input.name, trigger: input.trigger },
  });
  return { ok: true, id: data.id as string };
}

export interface UpdateAutomationInput {
  tenantId: string;
  actorUserId: string;
  automationId: string;
  name?: string;
  trigger?: AutomationTrigger;
  enabled?: boolean;
  conditionGroup?: ConditionGroup | null;
  maxRunsPerLead?: number | null;
  /** When provided, REPLACES the action set with this ordered list. */
  actions?: AutomationActionInput[];
}

/** Update fields and (optionally) replace the action set. */
export async function updateAutomation(
  supabase: DB,
  input: UpdateAutomationInput,
): Promise<ServiceResult> {
  if (input.trigger && !AUTOMATION_TRIGGERS.includes(input.trigger))
    return { ok: false, error: 'invalid_trigger' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.trigger !== undefined) patch.trigger = input.trigger;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.conditionGroup !== undefined) patch.condition_group = input.conditionGroup;
  if (input.maxRunsPerLead !== undefined) patch.max_runs_per_lead = input.maxRunsPerLead;

  const { error } = await supabase
    .from('automations')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.automationId);
  if (error) return { ok: false, error: 'update_failed' };

  if (input.actions !== undefined) {
    for (const a of input.actions) {
      if (!ACTION_TYPES.includes(a.type)) return { ok: false, error: 'invalid_action_type' };
    }
    await supabase
      .from('automation_actions')
      .delete()
      .eq('tenant_id', input.tenantId)
      .eq('automation_id', input.automationId);
    if (input.actions.length > 0) {
      const { error: insErr } = await supabase.from('automation_actions').insert(
        input.actions.map((a, i) => ({
          tenant_id: input.tenantId,
          automation_id: input.automationId,
          ordinal: i,
          action_type: a.type,
          params: a.params ?? {},
        })),
      );
      if (insErr) return { ok: false, error: 'actions_update_failed' };
    }
  }

  await writeAudit({
    action: 'AUTOMATION_UPDATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'automation',
    entityId: input.automationId,
    metadata: { fields: Object.keys(patch).filter((k) => k !== 'updated_at') },
  });
  return { ok: true, id: input.automationId };
}

/** Delete an automation (cascades to actions/runs). */
export async function deleteAutomation(
  supabase: DB,
  input: { tenantId: string; actorUserId: string; automationId: string },
): Promise<ServiceResult> {
  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('tenant_id', input.tenantId)
    .eq('id', input.automationId);
  if (error) return { ok: false, error: 'delete_failed' };
  await writeAudit({
    action: 'AUTOMATION_UPDATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'automation',
    entityId: input.automationId,
    metadata: { deleted: true },
  });
  return { ok: true, id: input.automationId };
}

/** Toggle the enabled flag. */
export async function toggleAutomation(
  supabase: DB,
  input: { tenantId: string; actorUserId: string; automationId: string; enabled: boolean },
): Promise<ServiceResult> {
  return updateAutomation(supabase, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    automationId: input.automationId,
    enabled: input.enabled,
  });
}

export interface RunAutomationInput {
  tenantId: string;
  actorUserId: string;
  trigger: AutomationTrigger;
  /** Run a single automation, or all enabled automations for the trigger. */
  automationId?: string | null;
  facts: Record<string, unknown>;
  changedFields?: string[];
  leadId?: string | null;
  correlationId?: string | null;
}

export interface RunAutomationResult extends ServiceResult {
  runs?: {
    automationId: string;
    runId: string;
    matched: boolean;
    skippedReason: string | null;
    executed: number;
    suppressed: number;
  }[];
}

/**
 * Evaluate one or all automations for a trigger event and record the runs.
 * Internal actions are executed against the lead (only when visible under RLS);
 * customer-send actions are recorded as suppressed (never delivered).
 */
export async function runAutomationForEvent(
  supabase: DB,
  input: RunAutomationInput,
): Promise<RunAutomationResult> {
  // Load the candidate automations (RLS-scoped) with their actions.
  let q = supabase
    .from('automations')
    .select('id, name, trigger, enabled, condition_group, max_runs_per_lead')
    .eq('tenant_id', input.tenantId)
    .eq('trigger', input.trigger);
  if (input.automationId) q = q.eq('id', input.automationId);
  else q = q.eq('enabled', true);
  const { data: autoRows } = await q;
  const automations = (autoRows ?? []) as {
    id: string;
    name: string;
    trigger: string;
    enabled: boolean;
    condition_group: ConditionGroup | null;
    max_runs_per_lead: number | null;
  }[];
  if (automations.length === 0) return { ok: true, runs: [] };

  const ids = automations.map((a) => a.id);
  const { data: actionRows } = await supabase
    .from('automation_actions')
    .select('automation_id, ordinal, action_type, params')
    .eq('tenant_id', input.tenantId)
    .in('automation_id', ids)
    .order('ordinal', { ascending: true });
  const actionsByAutomation = new Map<string, AutomationActionRow[]>();
  for (const r of (actionRows ?? []) as (AutomationActionRow & { automation_id: string })[]) {
    const list = actionsByAutomation.get(r.automation_id) ?? [];
    list.push(r);
    actionsByAutomation.set(r.automation_id, list);
  }

  // Confirm lead visibility once under RLS (used to guard internal mutations).
  let leadVisible = false;
  if (input.leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('id', input.leadId)
      .maybeSingle();
    leadVisible = Boolean(lead);
  }

  const results: NonNullable<RunAutomationResult['runs']> = [];

  for (const a of automations) {
    const def: AutomationDefinition = {
      id: a.id,
      trigger: a.trigger as AutomationTrigger,
      enabled: a.enabled,
      conditionGroup: a.condition_group,
      maxRunsPerLead: a.max_runs_per_lead,
      actions: (actionsByAutomation.get(a.id) ?? []).map((r) => ({
        type: r.action_type as ActionType,
        params: (r.params as Record<string, unknown> | null) ?? {},
      })),
    };

    // Prior-run count for this lead (anti-loop guard fed to the engine).
    let priorRuns = 0;
    if (input.leadId) {
      const { count } = await supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', input.tenantId)
        .eq('automation_id', a.id)
        .eq('lead_id', input.leadId)
        .eq('matched', true);
      priorRuns = count ?? 0;
    }

    const decision = evaluateAutomation(def, {
      trigger: input.trigger,
      facts: input.facts,
      changedFields: input.changedFields,
      priorRunsForLead: priorRuns,
    });

    const { data: run } = await supabase
      .from('automation_runs')
      .insert({
        tenant_id: input.tenantId,
        automation_id: a.id,
        lead_id: input.leadId ?? null,
        trigger: input.trigger,
        matched: decision.matched,
        skipped_reason: decision.skippedReason,
        correlation_id: input.correlationId ?? null,
      })
      .select('id')
      .single();
    const runId = (run?.id as string | undefined) ?? '';

    let executed = 0;
    let suppressed = 0;

    if (decision.matched && runId) {
      for (const action of decision.actions) {
        if (action.category === 'customer_send') {
          // Record-only — NEVER delivered. will_send stays false (DB also enforces).
          await supabase.from('automation_run_actions').insert({
            tenant_id: input.tenantId,
            run_id: runId,
            action_type: action.type,
            category: 'customer_send',
            will_send: false,
            suppressed_reason: action.suppressedReason ?? 'live_send_master_switch_off',
            status: 'suppressed',
            params: action.params,
          });
          suppressed++;
          await writeAudit({
            action: 'AUTOMATION_ACTION_SUPPRESSED',
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            entityType: 'automation_run',
            entityId: runId,
            metadata: { actionType: action.type, reason: 'live_send_master_switch_off' },
          });
          continue;
        }

        // Internal action — execute the real mutation, guarded by lead visibility.
        const status = await executeInternalAction(supabase, input, action, leadVisible);
        await supabase.from('automation_run_actions').insert({
          tenant_id: input.tenantId,
          run_id: runId,
          action_type: action.type,
          category: 'internal',
          will_send: false,
          status,
          params: action.params,
        });
        if (status === 'executed') {
          executed++;
          await writeAudit({
            action: 'AUTOMATION_ACTION_EXECUTED',
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            entityType: 'automation_run',
            entityId: runId,
            metadata: { actionType: action.type, leadId: input.leadId ?? null },
          });
        }
      }
    }

    if (runId) {
      await writeAudit({
        action: 'AUTOMATION_RUN',
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        entityType: 'automation_run',
        entityId: runId,
        metadata: {
          automationId: a.id,
          matched: decision.matched,
          executed,
          suppressed,
        },
      });
    }

    results.push({
      automationId: a.id,
      runId,
      matched: decision.matched,
      skippedReason: decision.skippedReason,
      executed,
      suppressed,
    });
  }

  return { ok: true, runs: results };
}

/**
 * Perform a single internal automation action. Returns the recorded status.
 * Each mutation that targets the lead is skipped (`skipped`) unless the lead is
 * visible under the caller's RLS.
 */
async function executeInternalAction(
  supabase: DB,
  input: RunAutomationInput,
  action: ResolvedAction,
  leadVisible: boolean,
): Promise<'executed' | 'skipped' | 'failed'> {
  const leadId = input.leadId ?? null;
  const needsLead = action.type !== 'notify_user';
  if (needsLead && (!leadId || !leadVisible)) return 'skipped';

  try {
    switch (action.type) {
      case 'create_task': {
        const title = String(action.params.taskTitle ?? action.params.title ?? 'Automation task');
        const { error } = await supabase.from('tasks').insert({
          tenant_id: input.tenantId,
          lead_id: leadId,
          title,
          status: 'open',
          assignee_id: (action.params.assigneeId as string | undefined) ?? null,
          created_by: input.actorUserId,
        });
        return error ? 'failed' : 'executed';
      }
      case 'change_stage': {
        const stageId = action.params.stageId as string | undefined;
        if (!stageId) return 'failed';
        const { error } = await supabase
          .from('leads')
          .update({ stage_id: stageId, updated_at: new Date().toISOString() })
          .eq('tenant_id', input.tenantId)
          .eq('id', leadId as string);
        if (error) return 'failed';
        await supabase.from('lead_stage_history').insert({
          tenant_id: input.tenantId,
          lead_id: leadId,
          to_stage_id: stageId,
          changed_by: input.actorUserId,
          reason: 'automation',
        });
        return 'executed';
      }
      case 'assign_lead': {
        const agentId = action.params.assigneeId as string | undefined;
        if (!agentId) return 'failed';
        // Deactivate the current active assignment, then add the new one.
        await supabase
          .from('lead_assignments')
          .update({ active: false })
          .eq('tenant_id', input.tenantId)
          .eq('lead_id', leadId as string)
          .eq('active', true);
        const { error } = await supabase.from('lead_assignments').insert({
          tenant_id: input.tenantId,
          lead_id: leadId,
          agent_id: agentId,
          assigned_by: input.actorUserId,
          reason: 'automation',
          is_manual: false,
          active: true,
        });
        return error ? 'failed' : 'executed';
      }
      case 'add_tag': {
        const tag = action.params.tag as string | undefined;
        if (!tag) return 'failed';
        const { error } = await supabase
          .from('lead_tags')
          .upsert(
            { tenant_id: input.tenantId, lead_id: leadId, tag },
            { onConflict: 'lead_id,tag', ignoreDuplicates: true },
          );
        return error ? 'failed' : 'executed';
      }
      case 'add_note': {
        const body = action.params.body as string | undefined;
        if (!body) return 'failed';
        const { error } = await supabase.from('lead_notes').insert({
          tenant_id: input.tenantId,
          lead_id: leadId,
          author_id: input.actorUserId,
          body,
        });
        return error ? 'failed' : 'executed';
      }
      case 'notify_user': {
        const recipient = action.params.userId as string | undefined;
        if (!recipient) return 'failed';
        const { error } = await supabase.from('notifications').insert({
          tenant_id: input.tenantId,
          recipient_user_id: recipient,
          kind: (action.params.kind as string | undefined) ?? 'mention',
          priority: (action.params.priority as string | undefined) ?? 'normal',
          title: String(action.params.title ?? 'Automation notification'),
          body: (action.params.body as string | undefined) ?? null,
          entity_type: leadId ? 'lead' : null,
          entity_id: leadId,
        });
        return error ? 'failed' : 'executed';
      }
      case 'enroll_sequence': {
        const sequenceId = action.params.sequenceId as string | undefined;
        if (!sequenceId) return 'failed';
        const { error } = await supabase.from('followup_enrollments').insert({
          tenant_id: input.tenantId,
          sequence_id: sequenceId,
          lead_id: leadId,
          status: 'active',
        });
        return error ? 'failed' : 'executed';
      }
      case 'unenroll_sequence': {
        const sequenceId = action.params.sequenceId as string | undefined;
        if (!sequenceId) return 'failed';
        const { error } = await supabase
          .from('followup_enrollments')
          .update({ status: 'stopped', stop_reason: 'automation_unenroll' })
          .eq('tenant_id', input.tenantId)
          .eq('lead_id', leadId as string)
          .eq('sequence_id', sequenceId)
          .eq('status', 'active');
        return error ? 'failed' : 'executed';
      }
      default:
        return 'skipped';
    }
  } catch {
    return 'failed';
  }
}

export interface AutomationRunView {
  id: string;
  trigger: string;
  matched: boolean;
  skippedReason: string | null;
  createdAt: string;
  actions: {
    actionType: string;
    category: 'internal' | 'customer_send';
    status: string;
    suppressedReason: string | null;
  }[];
}

/** Recent runs for an automation with their resolved actions (RLS-scoped). */
export async function listAutomationRuns(
  supabase: DB,
  tenantId: string,
  automationId: string,
  limit = 20,
): Promise<AutomationRunView[]> {
  const { data: runs } = await supabase
    .from('automation_runs')
    .select('id, trigger, matched, skipped_reason, created_at')
    .eq('tenant_id', tenantId)
    .eq('automation_id', automationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const runRows = (runs ?? []) as {
    id: string;
    trigger: string;
    matched: boolean;
    skipped_reason: string | null;
    created_at: string;
  }[];
  if (runRows.length === 0) return [];

  const { data: acts } = await supabase
    .from('automation_run_actions')
    .select('run_id, action_type, category, status, suppressed_reason')
    .eq('tenant_id', tenantId)
    .in(
      'run_id',
      runRows.map((r) => r.id),
    );
  const byRun = new Map<string, AutomationRunView['actions']>();
  for (const r of (acts ?? []) as {
    run_id: string;
    action_type: string;
    category: 'internal' | 'customer_send';
    status: string;
    suppressed_reason: string | null;
  }[]) {
    const list = byRun.get(r.run_id) ?? [];
    list.push({
      actionType: r.action_type,
      category: r.category,
      status: r.status,
      suppressedReason: r.suppressed_reason,
    });
    byRun.set(r.run_id, list);
  }

  return runRows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    matched: r.matched,
    skippedReason: r.skipped_reason,
    createdAt: r.created_at,
    actions: byRun.get(r.id) ?? [],
  }));
}

export { isCustomerSendAction };
