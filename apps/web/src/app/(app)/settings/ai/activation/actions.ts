'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActivationApprovalRole, ResponderMode } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createActivationRequest,
  recordActivationApproval,
  applyApprovedActivation,
  setKillSwitch,
  type ResponderChannel,
} from '@/lib/responder/activation';

/**
 * Phase 5B.1 responder activation server actions. Each enforces getAppContext +
 * an explicit ensurePermission; RLS re-checks server-side. NONE of these enable
 * real customer sending — the live-send master switch is a compile-time false,
 * so the strongest reachable state is `live_candidate` (still suppressed).
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

const channelSchema = z.enum(['website_chat', 'whatsapp', 'email', 'voice']);
const modeSchema = z.enum(['shadow', 'copilot', 'live_candidate']);
const roleSchema = z.enum(['product', 'engineering', 'legal']);
const projectIdSchema = z.string().uuid().nullable().optional();

export async function requestActivationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'responder.activation.request'))
    return { error: 'You do not have permission to request responder activation.' };

  const parsed = z
    .object({
      channel: channelSchema,
      requestedMode: modeSchema,
      projectId: projectIdSchema,
      summary: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      channel: formData.get('channel'),
      requestedMode: formData.get('requestedMode'),
      projectId: (formData.get('projectId') as string) || null,
      summary: (formData.get('summary') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid activation request.' };

  const supabase = await createSupabaseServerClient();
  const res = await createActivationRequest(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    channel: parsed.data.channel as ResponderChannel,
    projectId: parsed.data.projectId ?? null,
    requestedMode: parsed.data.requestedMode as ResponderMode,
    summary: parsed.data.summary ?? null,
  });
  revalidatePath('/settings/ai/activation');
  return res.ok ? { ok: true, id: res.id } : { error: res.error ?? 'Could not create request.' };
}

export async function recordApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'responder.activation.approve'))
    return { error: 'You do not have permission to approve responder activation.' };

  const parsed = z
    .object({
      requestId: z.string().uuid(),
      role: roleSchema,
      decision: z.enum(['approve', 'reject']),
      safeSummary: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      requestId: formData.get('requestId'),
      role: formData.get('role'),
      decision: formData.get('decision'),
      safeSummary: (formData.get('safeSummary') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid approval.' };

  const supabase = await createSupabaseServerClient();
  const res = await recordActivationApproval(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    requestId: parsed.data.requestId,
    role: parsed.data.role as ActivationApprovalRole,
    decision: parsed.data.decision,
    safeSummary: parsed.data.safeSummary ?? null,
  });
  revalidatePath('/settings/ai/activation');
  if (res.ok) return { ok: true, id: res.id };
  const msg =
    res.error === 'requester_cannot_approve'
      ? 'The requester cannot approve their own request.'
      : res.error === 'already_decided'
        ? 'You have already recorded a decision for this request.'
        : 'Could not record the approval.';
  return { error: msg };
}

export async function applyActivationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'responder.channel.manage'))
    return { error: 'You do not have permission to apply responder activation.' };

  const requestId = z.string().uuid().safeParse(formData.get('requestId'));
  if (!requestId.success) return { error: 'Invalid request id.' };

  const supabase = await createSupabaseServerClient();
  const res = await applyApprovedActivation(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    requestId: requestId.data,
  });
  revalidatePath('/settings/ai/activation');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not apply activation.' };
}

export async function setKillSwitchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'responder.killswitch.manage'))
    return { error: 'You do not have permission to manage the kill switch.' };

  const parsed = z
    .object({
      channel: channelSchema,
      projectId: projectIdSchema,
      active: z.enum(['true', 'false']),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse({
      channel: formData.get('channel'),
      projectId: (formData.get('projectId') as string) || null,
      active: formData.get('active'),
      reason: (formData.get('reason') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid kill-switch request.' };

  const supabase = await createSupabaseServerClient();
  const res = await setKillSwitch(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    channel: parsed.data.channel as ResponderChannel,
    projectId: parsed.data.projectId ?? null,
    active: parsed.data.active === 'true',
    reason: parsed.data.reason ?? null,
  });
  revalidatePath('/settings/ai/activation');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not update the kill switch.' };
}
