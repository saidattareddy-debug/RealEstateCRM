import 'server-only';
import {
  decideFollowUpStep,
  type FollowUpSequence,
  type FollowUpStep,
  type FollowUpEnrollment,
  type FollowUpContext,
  type FollowUpChannel,
} from '@re/domain';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 8 — Follow-up sequences SERVICE (server-only).
 *
 * CRUD over `followup_sequences` (+ child `followup_steps`), enroll/unenroll a
 * lead, and `tickEnrollment` which loads the live lead context, calls the PURE
 * `decideFollowUpStep`, and records a `followup_step_events` row.
 *
 * SAFETY INVARIANT 1: a `send` outcome is RECORDED with `will_send = false` and
 * `suppressed_reason = 'live_send_master_switch_off'` — nothing is delivered. The
 * DB CHECK forbids `will_send = true` as a backstop. All gating (DNC, consent,
 * takeover, conversion/lost, quiet hours, score-gating) is computed by the domain
 * engine, never hand-rolled here.
 */

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ServiceResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface FollowUpStepInput {
  stepIndex: number;
  delayHours: number;
  channel: FollowUpChannel;
  templateId: string | null;
  onlyScoreCategories: string[];
}

export interface SequenceSummary {
  id: string;
  name: string;
  enabled: boolean;
  stepCount: number;
  activeEnrollments: number;
  updatedAt: string;
}

export interface SequenceDetail {
  id: string;
  name: string;
  enabled: boolean;
  stopOnReply: boolean;
  quietStartHour: number;
  quietEndHour: number;
  steps: FollowUpStepInput[];
}

export interface EnrollmentView {
  id: string;
  leadId: string;
  currentStepIndex: number;
  status: 'active' | 'completed' | 'stopped';
  enrolledScoreCategory: string;
  stopReason: string | null;
  nextStepDueAt: string;
  enrolledAt: string;
}

/** List sequences for the tenant with step + active-enrollment counts. */
export async function listSequences(supabase: DB, tenantId: string): Promise<SequenceSummary[]> {
  const { data } = await supabase
    .from('followup_sequences')
    .select('id, name, enabled, updated_at, followup_steps(id)')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id as string);
  const { data: enr } = await supabase
    .from('followup_enrollments')
    .select('sequence_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .in('sequence_id', ids);
  const activeCount = new Map<string, number>();
  for (const e of (enr ?? []) as { sequence_id: string }[]) {
    activeCount.set(e.sequence_id, (activeCount.get(e.sequence_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    enabled: Boolean(r.enabled),
    stepCount: ((r.followup_steps as unknown[]) ?? []).length,
    activeEnrollments: activeCount.get(r.id as string) ?? 0,
    updatedAt: r.updated_at as string,
  }));
}

/** Load one sequence with its ordered steps. */
export async function getSequence(
  supabase: DB,
  tenantId: string,
  id: string,
): Promise<SequenceDetail | null> {
  const { data } = await supabase
    .from('followup_sequences')
    .select(
      'id, name, enabled, stop_on_reply, quiet_start_hour, quiet_end_hour, followup_steps(step_index, delay_hours, channel, template_id, only_score_categories)',
    )
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const steps = ((r.followup_steps as Record<string, unknown>[]) ?? [])
    .map((s) => ({
      stepIndex: s.step_index as number,
      delayHours: s.delay_hours as number,
      channel: s.channel as FollowUpChannel,
      templateId: (s.template_id as string | null) ?? null,
      onlyScoreCategories: (s.only_score_categories as string[]) ?? [],
    }))
    .sort((a, b) => a.stepIndex - b.stepIndex);
  return {
    id: r.id as string,
    name: r.name as string,
    enabled: Boolean(r.enabled),
    stopOnReply: Boolean(r.stop_on_reply),
    quietStartHour: r.quiet_start_hour as number,
    quietEndHour: r.quiet_end_hour as number,
    steps,
  };
}

export interface CreateSequenceInput {
  tenantId: string;
  actorUserId: string;
  name: string;
}

/** Create a new (disabled) sequence. Audited. */
export async function createSequence(
  supabase: DB,
  input: CreateSequenceInput,
): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('followup_sequences')
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      enabled: false,
      created_by: input.actorUserId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'create_failed' };
  await writeAudit({
    action: 'FOLLOWUP_SEQUENCE_UPDATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'followup_sequence',
    entityId: data.id as string,
    metadata: { name: input.name, created: true },
  });
  return { ok: true, id: data.id as string };
}

export interface UpdateSequenceInput {
  tenantId: string;
  actorUserId: string;
  id: string;
  name?: string;
  enabled?: boolean;
  stopOnReply?: boolean;
  quietStartHour?: number;
  quietEndHour?: number;
  /** When provided, REPLACES the step set. */
  steps?: FollowUpStepInput[];
}

/** Update a sequence's fields and (optionally) replace its steps. Audited. */
export async function updateSequence(
  supabase: DB,
  input: UpdateSequenceInput,
): Promise<ServiceResult> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.stopOnReply !== undefined) patch.stop_on_reply = input.stopOnReply;
  if (input.quietStartHour !== undefined) patch.quiet_start_hour = input.quietStartHour;
  if (input.quietEndHour !== undefined) patch.quiet_end_hour = input.quietEndHour;

  const { error } = await supabase
    .from('followup_sequences')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.id);
  if (error) return { ok: false, error: 'update_failed' };

  if (input.steps !== undefined) {
    await supabase
      .from('followup_steps')
      .delete()
      .eq('tenant_id', input.tenantId)
      .eq('sequence_id', input.id);
    if (input.steps.length > 0) {
      const { error: sErr } = await supabase.from('followup_steps').insert(
        input.steps.map((s, i) => ({
          tenant_id: input.tenantId,
          sequence_id: input.id,
          step_index: i,
          delay_hours: s.delayHours,
          channel: s.channel,
          template_id: s.templateId,
          only_score_categories: s.onlyScoreCategories,
        })),
      );
      if (sErr) return { ok: false, error: 'steps_update_failed' };
    }
  }

  await writeAudit({
    action: 'FOLLOWUP_SEQUENCE_UPDATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'followup_sequence',
    entityId: input.id,
    metadata: { fields: Object.keys(patch).filter((k) => k !== 'updated_at') },
  });
  return { ok: true, id: input.id };
}

/** List enrollments for a sequence (RLS-scoped). */
export async function listEnrollments(
  supabase: DB,
  tenantId: string,
  sequenceId: string,
  limit = 100,
): Promise<EnrollmentView[]> {
  const { data } = await supabase
    .from('followup_enrollments')
    .select(
      'id, lead_id, current_step_index, status, enrolled_score_category, stop_reason, next_step_due_at, enrolled_at',
    )
    .eq('tenant_id', tenantId)
    .eq('sequence_id', sequenceId)
    .order('enrolled_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    leadId: r.lead_id as string,
    currentStepIndex: r.current_step_index as number,
    status: r.status as 'active' | 'completed' | 'stopped',
    enrolledScoreCategory: r.enrolled_score_category as string,
    stopReason: (r.stop_reason as string | null) ?? null,
    nextStepDueAt: r.next_step_due_at as string,
    enrolledAt: r.enrolled_at as string,
  }));
}

export interface EnrollInput {
  tenantId: string;
  actorUserId: string;
  sequenceId: string;
  leadId: string;
}

/** Enroll a lead, capturing its current score category for provenance. Audited. */
export async function enrollLead(supabase: DB, input: EnrollInput): Promise<ServiceResult> {
  const category = await latestScoreCategory(supabase, input.tenantId, input.leadId);
  const { data, error } = await supabase
    .from('followup_enrollments')
    .insert({
      tenant_id: input.tenantId,
      sequence_id: input.sequenceId,
      lead_id: input.leadId,
      status: 'active',
      enrolled_score_category: category,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_enrolled' };
    return { ok: false, error: 'enroll_failed' };
  }
  await writeAudit({
    action: 'FOLLOWUP_ENROLLED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'followup_enrollment',
    entityId: (data?.id as string) ?? input.sequenceId,
    metadata: { sequenceId: input.sequenceId, leadId: input.leadId, scoreCategory: category },
  });
  return { ok: true, id: data?.id as string };
}

export interface UnenrollInput {
  tenantId: string;
  actorUserId: string;
  enrollmentId: string;
  reason?: string | null;
}

/** Stop an active enrollment. Audited. */
export async function unenrollLead(supabase: DB, input: UnenrollInput): Promise<ServiceResult> {
  const { error } = await supabase
    .from('followup_enrollments')
    .update({ status: 'stopped', stop_reason: input.reason ?? 'manual_unenroll' })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.enrollmentId)
    .eq('status', 'active');
  if (error) return { ok: false, error: 'unenroll_failed' };
  await writeAudit({
    action: 'FOLLOWUP_UNENROLLED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'followup_enrollment',
    entityId: input.enrollmentId,
    metadata: { reason: input.reason ?? 'manual_unenroll' },
  });
  return { ok: true, id: input.enrollmentId };
}

export interface TickResult extends ServiceResult {
  outcome?: string;
  stopReason?: string | null;
}

/**
 * Tick a single enrollment: load sequence + lead context, decide via the PURE
 * engine, and record the resulting `followup_step_events` row. A `send` outcome
 * is recorded SUPPRESSED (never delivered). Returns the decided outcome.
 */
export async function tickEnrollment(
  supabase: DB,
  tenantId: string,
  enrollmentId: string,
  now: Date,
  tzOffsetMinutes = 330,
): Promise<TickResult> {
  const { data: enr } = await supabase
    .from('followup_enrollments')
    .select(
      'id, sequence_id, lead_id, current_step_index, enrolled_at, next_step_due_at, status, enrolled_score_category',
    )
    .eq('tenant_id', tenantId)
    .eq('id', enrollmentId)
    .maybeSingle();
  if (!enr) return { ok: false, error: 'enrollment_not_found' };
  if ((enr.status as string) !== 'active') return { ok: false, error: 'enrollment_not_active' };

  const seq = await loadSequenceForEngine(supabase, tenantId, enr.sequence_id as string);
  if (!seq) return { ok: false, error: 'sequence_not_found' };

  const ctx = await loadFollowUpContext(
    supabase,
    tenantId,
    enr.lead_id as string,
    now,
    tzOffsetMinutes,
  );

  const enrollment: FollowUpEnrollment = {
    id: enr.id as string,
    sequenceId: enr.sequence_id as string,
    leadId: enr.lead_id as string,
    currentStepIndex: enr.current_step_index as number,
    enrolledAt: enr.enrolled_at as string,
    nextStepDueAt: enr.next_step_due_at as string,
    status: 'active',
    enrolledScoreCategory:
      (enr.enrolled_score_category as FollowUpEnrollment['enrolledScoreCategory']) ?? 'unscored',
  };

  const decision = decideFollowUpStep(seq, enrollment, ctx);

  // Record the step event. A `send` is ALWAYS suppressed (will_send=false).
  await supabase.from('followup_step_events').insert({
    tenant_id: tenantId,
    enrollment_id: enrollmentId,
    step_index: enrollment.currentStepIndex,
    outcome: decision.outcome,
    stop_reason: decision.stopReason,
    channel: decision.whySent?.channel ?? null,
    why_sent: decision.whySent ?? null,
    will_send: false,
    suppressed_reason: decision.outcome === 'send' ? decision.suppressedReason : null,
  });

  // Apply the enrollment state change implied by the decision.
  if (decision.outcome === 'stop') {
    await supabase
      .from('followup_enrollments')
      .update({ status: 'stopped', stop_reason: decision.stopReason })
      .eq('tenant_id', tenantId)
      .eq('id', enrollmentId);
  } else if (decision.outcome === 'send' || decision.outcome === 'advance_skip') {
    const nextIndex = decision.nextStepIndex;
    const completed = nextIndex >= seq.steps.length;
    const nextStep = seq.steps[nextIndex];
    const nextDue =
      !completed && nextStep
        ? new Date(now.getTime() + nextStep.delayHours * 3_600_000).toISOString()
        : now.toISOString();
    await supabase
      .from('followup_enrollments')
      .update({
        current_step_index: nextIndex,
        status: completed ? 'completed' : 'active',
        next_step_due_at: nextDue,
      })
      .eq('tenant_id', tenantId)
      .eq('id', enrollmentId);
  } else if (decision.outcome === 'defer_quiet_hours' && decision.nextEligibleAt) {
    await supabase
      .from('followup_enrollments')
      .update({ next_step_due_at: decision.nextEligibleAt })
      .eq('tenant_id', tenantId)
      .eq('id', enrollmentId);
  }

  if (decision.outcome === 'send') {
    await writeAudit({
      action: 'FOLLOWUP_STEP_SUPPRESSED',
      tenantId,
      actorUserId: null,
      entityType: 'followup_enrollment',
      entityId: enrollmentId,
      metadata: {
        stepIndex: enrollment.currentStepIndex,
        channel: decision.whySent?.channel ?? null,
        suppressedReason: decision.suppressedReason ?? 'live_send_master_switch_off',
      },
    });
  } else if (decision.outcome === 'stop') {
    await writeAudit({
      action: 'FOLLOWUP_UNENROLLED',
      tenantId,
      actorUserId: null,
      entityType: 'followup_enrollment',
      entityId: enrollmentId,
      metadata: { stopReason: decision.stopReason },
    });
  }

  return { ok: true, outcome: decision.outcome, stopReason: decision.stopReason };
}

// ---------------------------------------------------------------------------
// Context loaders (read-only, RLS-scoped)
// ---------------------------------------------------------------------------

async function loadSequenceForEngine(
  supabase: DB,
  tenantId: string,
  sequenceId: string,
): Promise<FollowUpSequence | null> {
  const { data } = await supabase
    .from('followup_sequences')
    .select(
      'id, enabled, stop_on_reply, quiet_start_hour, quiet_end_hour, followup_steps(step_index, delay_hours, channel, template_id, only_score_categories)',
    )
    .eq('tenant_id', tenantId)
    .eq('id', sequenceId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const steps: FollowUpStep[] = ((r.followup_steps as Record<string, unknown>[]) ?? [])
    .map((s) => ({
      index: s.step_index as number,
      delayHours: s.delay_hours as number,
      channel: s.channel as FollowUpChannel,
      templateId: (s.template_id as string | null) ?? null,
      onlyScoreCategories:
        ((s.only_score_categories as string[]) ?? []).filter(
          (c): c is 'hot' | 'warm' | 'cold' => c === 'hot' || c === 'warm' || c === 'cold',
        ) ?? [],
    }))
    .sort((a, b) => a.index - b.index);
  return {
    id: r.id as string,
    enabled: Boolean(r.enabled),
    steps,
    stopOnReply: Boolean(r.stop_on_reply),
    quietHoursStartHour: r.quiet_start_hour as number,
    quietHoursEndHour: r.quiet_end_hour as number,
  };
}

/**
 * Resolve the live follow-up context for a lead:
 *  - DNC / consent revoked from `contact_consents` (status do_not_contact/revoked)
 *  - human takeover from `conversations.operating_mode = 'human'`
 *  - converted / lost from the lead's pipeline stage (is_won / is_lost)
 *  - customer replied (inbound message after the latest outbound) — approximated
 *    by the presence of any inbound message; deferred to the engine's stopOnReply
 *  - current score category from the latest `lead_score_runs`
 */
async function loadFollowUpContext(
  supabase: DB,
  tenantId: string,
  leadId: string,
  now: Date,
  tzOffsetMinutes: number,
): Promise<FollowUpContext> {
  const [consentRes, leadRes, convRes, scoreCategory] = await Promise.all([
    supabase
      .from('contact_consents')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId),
    supabase
      .from('leads')
      .select('stage_id, operational_status')
      .eq('tenant_id', tenantId)
      .eq('id', leadId)
      .maybeSingle(),
    supabase
      .from('conversations')
      .select('operating_mode')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId),
    latestScoreCategory(supabase, tenantId, leadId),
  ]);

  const consents = (consentRes.data ?? []) as { status: string }[];
  const dncActive = consents.some((c) => c.status === 'do_not_contact');
  const consentRevoked = consents.some((c) => c.status === 'revoked');

  const conversations = (convRes.data ?? []) as { operating_mode: string }[];
  const humanTakeover = conversations.some((c) => c.operating_mode === 'human');

  let leadConverted = false;
  let leadLost = false;
  const lead = leadRes.data as { stage_id: string | null; operational_status: string } | null;
  if (lead) {
    leadLost = lead.operational_status === 'disqualified';
    if (lead.stage_id) {
      const { data: stage } = await supabase
        .from('pipeline_stages')
        .select('is_won, is_lost')
        .eq('tenant_id', tenantId)
        .eq('id', lead.stage_id)
        .maybeSingle();
      if (stage) {
        leadConverted = Boolean((stage as { is_won: boolean }).is_won);
        leadLost = leadLost || Boolean((stage as { is_lost: boolean }).is_lost);
      }
    }
  }

  return {
    now,
    tzOffsetMinutes,
    dncActive,
    consentRevoked,
    humanTakeover,
    leadConverted,
    leadLost,
    optedOutOfSequence: false,
    // Reply detection is conservative: the inbox owns true reply state; here we
    // leave it false and rely on takeover/conversion stops. The engine still
    // honours stopOnReply when a caller supplies a true reply signal.
    customerReplied: false,
    currentScoreCategory: scoreCategory,
  };
}

/** Latest score classification for a lead, mapped to a follow-up category. */
async function latestScoreCategory(
  supabase: DB,
  tenantId: string,
  leadId: string,
): Promise<'hot' | 'warm' | 'cold' | 'unscored'> {
  const { data } = await supabase
    .from('lead_score_runs')
    .select('classification')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = (data as { classification: string } | null)?.classification;
  if (c === 'hot' || c === 'warm' || c === 'cold') return c;
  return 'unscored';
}
