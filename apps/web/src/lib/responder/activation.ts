import 'server-only';
import {
  evaluateLiveActivation,
  evaluateApprovalCompleteness,
  isApplicableMode,
  ACTIVATION_APPROVAL_ROLES,
  RESPONDER_MODES,
  type ResponderMode,
  type ActivationApproval,
  type ActivationApprovalRole,
  type LiveActivationDecision,
} from '@re/domain';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 5B.1 — responder live-send ACTIVATION SERVICE (two-person governance).
 *
 * Drives the Phase-5B.0 tables (`responder_channel_settings`,
 * `responder_activation_requests`, `responder_activation_approvals`) under the
 * caller's RLS. It NEVER sends a customer message and never enables real sending:
 *  - the strongest mode it will ever write is `live_candidate`, which the
 *    per-message gate (`evaluateLiveSendGates`) still suppresses while the
 *    compile-time `LIVE_SEND_MASTER_SWITCH` is false;
 *  - it refuses to persist any "sendable" mode (`isApplicableMode`);
 *  - the DB trigger forbids a requester approving their own request, and the
 *    domain `evaluateLiveActivation` re-checks completeness.
 *
 * Every mutation is permission-gated by the caller (server actions) and audited
 * with reference ids + safe summaries only.
 */

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type ResponderChannel = 'website_chat' | 'whatsapp' | 'email' | 'voice';

/** Modes a request may ask for. Excludes `disabled` (that is a direct stand-down). */
export const REQUESTABLE_MODES: ResponderMode[] = ['shadow', 'copilot', 'live_candidate'];

export interface ActivationStateView {
  channel: ResponderChannel;
  projectId: string | null;
  currentMode: ResponderMode;
  killSwitchActive: boolean;
  rolloutPercentage: number;
  effectiveStart: string | null;
  effectiveExpiry: string | null;
  pendingRequest: {
    id: string;
    requestedMode: ResponderMode;
    requestedBy: string;
    summary: string | null;
    createdAt: string;
    approvals: {
      role: ActivationApprovalRole;
      approverId: string;
      decision: 'approve' | 'reject';
    }[];
  } | null;
  decision: LiveActivationDecision;
}

interface ChannelSettingsRow {
  mode: string | null;
  kill_switch_active: boolean | null;
  rollout_percentage: number | null;
  effective_start: string | null;
  effective_expiry: string | null;
}

function withinWindow(start: string | null, expiry: string | null, now = new Date()): boolean {
  if (start && now < new Date(start)) return false;
  if (expiry && now > new Date(expiry)) return false;
  return true;
}

/** Read the full activation state for a tenant/channel(/project) and decide. */
export async function getActivationState(
  supabase: DB,
  tenantId: string,
  channel: ResponderChannel,
  projectId: string | null = null,
): Promise<ActivationStateView> {
  let settingsQuery = supabase
    .from('responder_channel_settings')
    .select('mode, kill_switch_active, rollout_percentage, effective_start, effective_expiry')
    .eq('tenant_id', tenantId)
    .eq('channel', channel);
  settingsQuery = projectId
    ? settingsQuery.eq('project_id', projectId)
    : settingsQuery.is('project_id', null);
  const { data: settings } = await settingsQuery.maybeSingle();
  const s = (settings as ChannelSettingsRow | null) ?? null;

  const currentMode = (s?.mode as ResponderMode | undefined) ?? 'disabled';
  const killSwitchActive = Boolean(s?.kill_switch_active);
  const rolloutPercentage = s?.rollout_percentage ?? 0;
  const effectiveStart = s?.effective_start ?? null;
  const effectiveExpiry = s?.effective_expiry ?? null;

  // Latest pending request for this channel/project.
  let reqQuery = supabase
    .from('responder_activation_requests')
    .select('id, requested_mode, requested_by, summary, created_at')
    .eq('tenant_id', tenantId)
    .eq('channel', channel)
    .eq('status', 'pending');
  reqQuery = projectId ? reqQuery.eq('project_id', projectId) : reqQuery.is('project_id', null);
  const { data: reqRows } = await reqQuery.order('created_at', { ascending: false }).limit(1);
  const req = (reqRows ?? [])[0] as
    | {
        id: string;
        requested_mode: string;
        requested_by: string;
        summary: string | null;
        created_at: string;
      }
    | undefined;

  let approvals: ActivationApproval[] = [];
  let pendingRequest: ActivationStateView['pendingRequest'] = null;
  if (req) {
    const { data: appRows } = await supabase
      .from('responder_activation_approvals')
      .select('approval_role, approver_id, decision')
      .eq('tenant_id', tenantId)
      .eq('request_id', req.id);
    approvals = (
      (appRows ?? []) as { approval_role: string; approver_id: string; decision: string }[]
    ).map((r) => ({
      role: r.approval_role as ActivationApprovalRole,
      approverId: r.approver_id,
      decision: r.decision === 'reject' ? 'reject' : 'approve',
    }));
    pendingRequest = {
      id: req.id,
      requestedMode: req.requested_mode as ResponderMode,
      requestedBy: req.requested_by,
      summary: req.summary,
      createdAt: req.created_at,
      approvals: approvals.map((a) => ({
        role: a.role,
        approverId: a.approverId,
        decision: a.decision,
      })),
    };
  }

  const decision = evaluateLiveActivation({
    masterSwitchOn: true, // caller-side belief; ANDed with the compile-time false in the engine
    hasPendingRequest: Boolean(req),
    requestedMode: (req?.requested_mode as ResponderMode | undefined) ?? 'disabled',
    approvals,
    requesterId: req?.requested_by ?? '',
    killSwitchActive,
    withinEffectiveWindow: withinWindow(effectiveStart, effectiveExpiry),
    rolloutConfigured: rolloutPercentage > 0 && Boolean(effectiveStart),
  });

  return {
    channel,
    projectId,
    currentMode,
    killSwitchActive,
    rolloutPercentage,
    effectiveStart,
    effectiveExpiry,
    pendingRequest,
    decision,
  };
}

export interface CreateRequestInput {
  tenantId: string;
  actorUserId: string;
  channel: ResponderChannel;
  projectId?: string | null;
  requestedMode: ResponderMode;
  summary?: string | null;
  externalReference?: string | null;
}

export interface ServiceResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Create a pending activation request. Refuses any sendable / non-requestable mode. */
export async function createActivationRequest(
  supabase: DB,
  input: CreateRequestInput,
): Promise<ServiceResult> {
  if (!REQUESTABLE_MODES.includes(input.requestedMode) || !isApplicableMode(input.requestedMode)) {
    return { ok: false, error: 'invalid_requested_mode' };
  }
  const { data, error } = await supabase
    .from('responder_activation_requests')
    .insert({
      tenant_id: input.tenantId,
      channel: input.channel,
      project_id: input.projectId ?? null,
      requested_mode: input.requestedMode,
      requested_by: input.actorUserId,
      status: 'pending',
      summary: input.summary ?? null,
      external_reference: input.externalReference ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'request_failed' };

  await writeAudit({
    action: 'RESPONDER_ACTIVATION_REQUESTED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'responder_activation_request',
    entityId: data.id as string,
    metadata: {
      channel: input.channel,
      requestedMode: input.requestedMode,
      projectId: input.projectId ?? null,
    },
  });
  return { ok: true, id: data.id as string };
}

export interface RecordApprovalInput {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  role: ActivationApprovalRole;
  decision: 'approve' | 'reject';
  safeSummary?: string | null;
  externalReference?: string | null;
}

/**
 * Record a role approval/rejection. The DB trigger forbids the requester
 * approving their own request; a duplicate approver is rejected by the unique
 * constraint. On a full approval set this does NOT itself apply the mode — call
 * `applyApprovedActivation` to do so (still never enabling real sending).
 */
export async function recordActivationApproval(
  supabase: DB,
  input: RecordApprovalInput,
): Promise<ServiceResult> {
  if (!ACTIVATION_APPROVAL_ROLES.includes(input.role)) return { ok: false, error: 'invalid_role' };
  const { data, error } = await supabase
    .from('responder_activation_approvals')
    .insert({
      tenant_id: input.tenantId,
      request_id: input.requestId,
      approval_role: input.role,
      approver_id: input.actorUserId,
      decision: input.decision,
      safe_summary: input.safeSummary ?? null,
      external_reference: input.externalReference ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    // 23505 = duplicate approver; trigger raise = self-approval.
    if (error?.code === '23505') return { ok: false, error: 'already_decided' };
    if ((error?.message ?? '').includes('requester_cannot_approve_own_request'))
      return { ok: false, error: 'requester_cannot_approve' };
    return { ok: false, error: 'approval_failed' };
  }

  await writeAudit({
    action: 'RESPONDER_ACTIVATION_APPROVED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'responder_activation_request',
    entityId: input.requestId,
    metadata: { role: input.role, decision: input.decision },
  });
  return { ok: true, id: data.id as string };
}

/**
 * Apply a fully-approved request to the channel settings. Persists at most
 * `live_candidate` (never a sendable mode); real customer sending stays
 * impossible because the master switch is a compile-time false. Returns the
 * mode actually applied.
 */
export async function applyApprovedActivation(
  supabase: DB,
  input: { tenantId: string; actorUserId: string; requestId: string },
): Promise<ServiceResult & { appliedMode?: ResponderMode }> {
  const { data: req } = await supabase
    .from('responder_activation_requests')
    .select('id, channel, project_id, requested_mode, requested_by, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: 'request_not_found' };
  if ((req.status as string) !== 'pending') return { ok: false, error: 'request_not_pending' };

  const { data: appRows } = await supabase
    .from('responder_activation_approvals')
    .select('approval_role, approver_id, decision')
    .eq('tenant_id', input.tenantId)
    .eq('request_id', input.requestId);
  const approvals: ActivationApproval[] = (
    (appRows ?? []) as {
      approval_role: string;
      approver_id: string;
      decision: string;
    }[]
  ).map((r) => ({
    role: r.approval_role as ActivationApprovalRole,
    approverId: r.approver_id,
    decision: r.decision === 'reject' ? 'reject' : 'approve',
  }));

  const completeness = evaluateApprovalCompleteness(approvals, req.requested_by as string);
  if (!completeness.complete) return { ok: false, error: 'approvals_incomplete' };

  const requested = req.requested_mode as ResponderMode;
  // Defense in depth: never persist a sendable mode, even if one were requested.
  const appliedMode: ResponderMode = isApplicableMode(requested) ? requested : 'live_candidate';
  if (!RESPONDER_MODES.includes(appliedMode)) return { ok: false, error: 'invalid_mode' };

  const channel = req.channel as ResponderChannel;
  const projectId = (req.project_id as string | null) ?? null;
  let upd = supabase
    .from('responder_channel_settings')
    .update({
      mode: appliedMode,
      enabled_by: input.actorUserId,
      enabled_at: new Date().toISOString(),
      approval_reference: input.requestId,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('channel', channel);
  upd = projectId ? upd.eq('project_id', projectId) : upd.is('project_id', null);
  const { error: updErr } = await upd;
  if (updErr) return { ok: false, error: 'apply_failed' };

  await supabase
    .from('responder_activation_requests')
    .update({ status: 'approved' })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.requestId);

  await writeAudit({
    action: 'RESPONDER_CHANNEL_UPDATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'responder_channel_settings',
    entityId: input.requestId,
    metadata: {
      channel,
      projectId,
      appliedMode,
      note: 'live_sending_remains_disabled_by_master_switch',
    },
  });
  return { ok: true, appliedMode };
}

export interface KillSwitchInput {
  tenantId: string;
  actorUserId: string;
  channel: ResponderChannel;
  projectId?: string | null;
  active: boolean;
  reason?: string | null;
}

/** Toggle the per-channel kill switch (immediate stand-down). Audited. */
export async function setKillSwitch(supabase: DB, input: KillSwitchInput): Promise<ServiceResult> {
  let upd = supabase
    .from('responder_channel_settings')
    .update({
      kill_switch_active: input.active,
      kill_switch_reason: input.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('channel', input.channel);
  upd = input.projectId ? upd.eq('project_id', input.projectId) : upd.is('project_id', null);
  const { error } = await upd;
  if (error) return { ok: false, error: 'kill_switch_failed' };

  await writeAudit({
    action: 'RESPONDER_KILLSWITCH_ACTIVATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'responder_channel_settings',
    entityId: input.channel,
    metadata: { channel: input.channel, projectId: input.projectId ?? null, active: input.active },
  });
  return { ok: true };
}
