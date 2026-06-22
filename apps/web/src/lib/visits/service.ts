import 'server-only';
import {
  detectDoubleBooking,
  transitionVisit,
  resolveVisitOutcomeState,
  isTerminalVisitState,
  canTransitionVisit,
  VISIT_STATES,
  type VisitState,
  type BusyBlock,
  type VisitOutcome,
} from '@re/domain';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 8 — Site-visit SERVICE (server-only).
 *
 * Schedules visits, transitions their lifecycle, and records outcomes. Calendar
 * is SIMULATION-ONLY (status never 'connected'; no network IO).
 *
 * SAFETY INVARIANT 4: before scheduling/rescheduling, double-booking is checked
 * via the PURE `detectDoubleBooking` against the agent's busy blocks (their
 * `site_visits` + `calendar_busy_blocks`). All state transitions are validated by
 * `canTransitionVisit`/`transitionVisit`. Everything is audited.
 */

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ServiceResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface VisitView {
  id: string;
  leadId: string;
  projectId: string | null;
  agentId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  state: VisitState;
  location: string | null;
  notes: string | null;
}

export interface VisitDetail extends VisitView {
  allowedTransitions: VisitState[];
  terminal: boolean;
  outcome: { attended: boolean; interestLevel: string | null; feedback: string | null } | null;
}

/** List visits for the tenant (RLS-scoped), newest scheduled first. */
export async function listVisits(
  supabase: DB,
  tenantId: string,
  filters: { agentId?: string | null; state?: VisitState | null } = {},
): Promise<VisitView[]> {
  let q = supabase
    .from('site_visits')
    .select(
      'id, lead_id, project_id, agent_id, scheduled_start, scheduled_end, state, location, notes',
    )
    .eq('tenant_id', tenantId);
  if (filters.agentId) q = q.eq('agent_id', filters.agentId);
  if (filters.state) q = q.eq('state', filters.state);
  const { data } = await q.order('scheduled_start', { ascending: true, nullsFirst: false });
  return ((data ?? []) as Record<string, unknown>[]).map(mapVisit);
}

/** Load a single visit with its allowed transitions + outcome. */
export async function getVisit(
  supabase: DB,
  tenantId: string,
  id: string,
): Promise<VisitDetail | null> {
  const { data } = await supabase
    .from('site_visits')
    .select(
      'id, lead_id, project_id, agent_id, scheduled_start, scheduled_end, state, location, notes',
    )
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const v = mapVisit(data as Record<string, unknown>);

  const { data: outcomeRow } = await supabase
    .from('visit_outcomes')
    .select('attended, interest_level, feedback')
    .eq('tenant_id', tenantId)
    .eq('visit_id', id)
    .maybeSingle();

  const allowedTransitions = VISIT_STATES.filter((s) => canTransitionVisit(v.state, s));

  return {
    ...v,
    allowedTransitions,
    terminal: isTerminalVisitState(v.state),
    outcome: outcomeRow
      ? {
          attended: Boolean((outcomeRow as { attended: boolean }).attended),
          interestLevel: (outcomeRow as { interest_level: string | null }).interest_level ?? null,
          feedback: (outcomeRow as { feedback: string | null }).feedback ?? null,
        }
      : null,
  };
}

function mapVisit(r: Record<string, unknown>): VisitView {
  return {
    id: r.id as string,
    leadId: r.lead_id as string,
    projectId: (r.project_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    scheduledStart: (r.scheduled_start as string | null) ?? null,
    scheduledEnd: (r.scheduled_end as string | null) ?? null,
    state: r.state as VisitState,
    location: (r.location as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

/** Collect an agent's busy blocks (their visits + simulated calendar blocks). */
async function loadBusyBlocks(
  supabase: DB,
  tenantId: string,
  agentId: string,
  excludeVisitId?: string,
): Promise<BusyBlock[]> {
  const [{ data: visits }, { data: blocks }] = await Promise.all([
    supabase
      .from('site_visits')
      .select('id, scheduled_start, scheduled_end, state')
      .eq('tenant_id', tenantId)
      .eq('agent_id', agentId)
      .not('scheduled_start', 'is', null)
      .not('scheduled_end', 'is', null),
    supabase
      .from('calendar_busy_blocks')
      .select('id, ref_id, source, block_start, block_end')
      .eq('tenant_id', tenantId)
      .eq('agent_id', agentId),
  ]);

  const busy: BusyBlock[] = [];
  for (const v of (visits ?? []) as Record<string, unknown>[]) {
    const id = v.id as string;
    const state = v.state as VisitState;
    if (id === excludeVisitId) continue;
    if (isTerminalVisitState(state) || state === 'no_show') continue;
    busy.push({
      start: v.scheduled_start as string,
      end: v.scheduled_end as string,
      source: 'visit',
      refId: id,
    });
  }
  for (const b of (blocks ?? []) as Record<string, unknown>[]) {
    // A block already mirroring the visit we are editing must not self-conflict.
    if (excludeVisitId && (b.ref_id as string | null) === excludeVisitId) continue;
    busy.push({
      start: b.block_start as string,
      end: b.block_end as string,
      source: (b.source as 'visit' | 'calendar') ?? 'calendar',
      refId: (b.ref_id as string | null) ?? (b.id as string),
    });
  }
  return busy;
}

export interface ScheduleVisitInput {
  tenantId: string;
  actorUserId: string;
  leadId: string;
  projectId?: string | null;
  agentId: string;
  scheduledStart: string;
  scheduledEnd: string;
  location?: string | null;
  notes?: string | null;
}

export interface ScheduleVisitResult extends ServiceResult {
  conflict?: boolean;
  conflicts?: { start: string; end: string; source: string; refId: string }[];
}

/**
 * Schedule a new visit. Rejects on a double-booking conflict (checked via the
 * PURE engine). On success inserts the visit + a mirroring busy block + a
 * `visit_event` and audits VISIT_SCHEDULED.
 */
export async function scheduleVisit(
  supabase: DB,
  input: ScheduleVisitInput,
): Promise<ScheduleVisitResult> {
  const busy = await loadBusyBlocks(supabase, input.tenantId, input.agentId);
  const check = detectDoubleBooking({ start: input.scheduledStart, end: input.scheduledEnd }, busy);
  if (check.conflict) {
    return {
      ok: false,
      error: 'double_booking',
      conflict: true,
      conflicts: check.conflicts.map((c) => ({
        start: c.start,
        end: c.end,
        source: c.source,
        refId: c.refId,
      })),
    };
  }

  const { data, error } = await supabase
    .from('site_visits')
    .insert({
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      project_id: input.projectId ?? null,
      agent_id: input.agentId,
      scheduled_start: input.scheduledStart,
      scheduled_end: input.scheduledEnd,
      state: 'scheduled',
      location: input.location ?? null,
      notes: input.notes ?? null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'schedule_failed' };
  const visitId = data.id as string;

  await supabase.from('calendar_busy_blocks').insert({
    tenant_id: input.tenantId,
    agent_id: input.agentId,
    source: 'visit',
    ref_id: visitId,
    block_start: input.scheduledStart,
    block_end: input.scheduledEnd,
  });

  await supabase.from('visit_events').insert({
    tenant_id: input.tenantId,
    visit_id: visitId,
    from_state: null,
    to_state: 'scheduled',
    actor_id: input.actorUserId,
    reason: 'scheduled',
  });

  await writeAudit({
    action: 'VISIT_SCHEDULED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'site_visit',
    entityId: visitId,
    metadata: { leadId: input.leadId, agentId: input.agentId, projectId: input.projectId ?? null },
  });
  return { ok: true, id: visitId };
}

export interface TransitionVisitInput {
  tenantId: string;
  actorUserId: string;
  visitId: string;
  toState: VisitState;
  reason?: string | null;
}

/**
 * Transition a visit. Validated by the PURE `transitionVisit`. Records a
 * `visit_event` and audits VISIT_TRANSITIONED. (Outcomes use `recordOutcome`.)
 */
export async function transitionVisitState(
  supabase: DB,
  input: TransitionVisitInput,
): Promise<ServiceResult> {
  const { data: visit } = await supabase
    .from('site_visits')
    .select('id, state')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.visitId)
    .maybeSingle();
  if (!visit) return { ok: false, error: 'visit_not_found' };

  const from = visit.state as VisitState;
  const result = transitionVisit(from, input.toState);
  if (!result.ok) return { ok: false, error: result.reason ?? 'illegal_transition' };

  const { error } = await supabase
    .from('site_visits')
    .update({ state: input.toState, updated_at: new Date().toISOString() })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.visitId);
  if (error) return { ok: false, error: 'transition_failed' };

  // If the visit is cancelled/no_show/rescheduled away, free its busy block.
  if (isTerminalVisitState(input.toState) || input.toState === 'no_show') {
    await supabase
      .from('calendar_busy_blocks')
      .delete()
      .eq('tenant_id', input.tenantId)
      .eq('ref_id', input.visitId)
      .eq('source', 'visit');
  }

  await supabase.from('visit_events').insert({
    tenant_id: input.tenantId,
    visit_id: input.visitId,
    from_state: from,
    to_state: input.toState,
    actor_id: input.actorUserId,
    reason: input.reason ?? null,
  });

  await writeAudit({
    action: 'VISIT_TRANSITIONED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'site_visit',
    entityId: input.visitId,
    metadata: { from, to: input.toState, reason: input.reason ?? null },
  });
  return { ok: true, id: input.visitId };
}

export interface RecordOutcomeInput {
  tenantId: string;
  actorUserId: string;
  visitId: string;
  attended: boolean;
  interestLevel?: 'high' | 'medium' | 'low' | null;
  feedback?: string | null;
}

/**
 * Record a visit outcome. Resolves the terminal state (completed/no_show) via the
 * PURE `resolveVisitOutcomeState`, transitions there if legal, writes the
 * `visit_outcome`, and audits VISIT_OUTCOME_RECORDED.
 */
export async function recordOutcome(
  supabase: DB,
  input: RecordOutcomeInput,
): Promise<ServiceResult> {
  const { data: visit } = await supabase
    .from('site_visits')
    .select('id, state, agent_id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.visitId)
    .maybeSingle();
  if (!visit) return { ok: false, error: 'visit_not_found' };

  const outcome: VisitOutcome = {
    attended: input.attended,
    feedback: input.feedback ?? null,
    interestLevel: input.interestLevel ?? null,
  };
  const targetState = resolveVisitOutcomeState(outcome);
  const from = visit.state as VisitState;

  // Transition to the terminal/outcome state if the move is legal and needed.
  if (from !== targetState && canTransitionVisit(from, targetState)) {
    await supabase
      .from('site_visits')
      .update({ state: targetState, updated_at: new Date().toISOString() })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.visitId);
    await supabase.from('visit_events').insert({
      tenant_id: input.tenantId,
      visit_id: input.visitId,
      from_state: from,
      to_state: targetState,
      actor_id: input.actorUserId,
      reason: 'outcome_recorded',
    });
    // A completed/no_show visit no longer occupies the agent's calendar.
    await supabase
      .from('calendar_busy_blocks')
      .delete()
      .eq('tenant_id', input.tenantId)
      .eq('ref_id', input.visitId)
      .eq('source', 'visit');
  }

  const { error } = await supabase.from('visit_outcomes').insert({
    tenant_id: input.tenantId,
    visit_id: input.visitId,
    attended: input.attended,
    interest_level: input.interestLevel ?? null,
    feedback: input.feedback ?? null,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'outcome_exists' };
    return { ok: false, error: 'outcome_failed' };
  }

  await writeAudit({
    action: 'VISIT_OUTCOME_RECORDED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'site_visit',
    entityId: input.visitId,
    metadata: {
      attended: input.attended,
      interestLevel: input.interestLevel ?? null,
      resolvedState: targetState,
    },
  });
  return { ok: true, id: input.visitId };
}

export interface CalendarConnectionView {
  provider: 'google' | 'outlook' | 'manual';
  status: 'disconnected' | 'simulated';
}

/** Get an agent's calendar connection (defaults to disconnected/google). */
export async function getCalendarConnection(
  supabase: DB,
  tenantId: string,
  agentId: string,
): Promise<CalendarConnectionView> {
  const { data } = await supabase
    .from('calendar_connections')
    .select('provider, status')
    .eq('tenant_id', tenantId)
    .eq('agent_id', agentId)
    .maybeSingle();
  if (!data) return { provider: 'google', status: 'disconnected' };
  return {
    provider: (data as { provider: CalendarConnectionView['provider'] }).provider,
    status: (data as { status: CalendarConnectionView['status'] }).status,
  };
}

export interface UpsertCalendarConnectionInput {
  tenantId: string;
  actorUserId: string;
  agentId: string;
  provider: 'google' | 'outlook' | 'manual';
  status: 'disconnected' | 'simulated';
}

/**
 * Upsert an agent's calendar connection. SAFETY INVARIANT 4: status is constrained
 * to `disconnected | simulated` — never `connected`. No network IO is performed;
 * no OAuth tokens/secrets are stored.
 */
export async function upsertCalendarConnection(
  supabase: DB,
  input: UpsertCalendarConnectionInput,
): Promise<ServiceResult> {
  // Defense in depth: refuse any status other than the two simulation values.
  if (input.status !== 'disconnected' && input.status !== 'simulated')
    return { ok: false, error: 'invalid_status' };

  const { error } = await supabase.from('calendar_connections').upsert(
    {
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      provider: input.provider,
      status: input.status,
      metadata: { simulated: true },
    },
    { onConflict: 'tenant_id,agent_id,provider' },
  );
  if (error) return { ok: false, error: 'connection_failed' };
  return { ok: true };
}
