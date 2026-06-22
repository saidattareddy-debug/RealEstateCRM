'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { FollowUpChannel } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createSequence,
  updateSequence,
  enrollLead,
  unenrollLead,
  type FollowUpStepInput,
} from '@/lib/followups/service';

/**
 * Phase 8 follow-up sequence server actions. Each enforces getAppContext +
 * ensurePermission('followups.manage'); RLS re-checks server-side. Sequence sends
 * are never delivered — `tickEnrollment` records every `send` as suppressed.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

const channelSchema = z.enum(['whatsapp', 'email', 'task_reminder']);
const categorySchema = z.enum(['hot', 'warm', 'cold']);

const stepSchema = z.object({
  delayHours: z.coerce.number().int().min(0).max(8760),
  channel: channelSchema,
  templateId: z.string().uuid().nullable().optional(),
  onlyScoreCategories: z.array(categorySchema).max(3),
});

export async function createSequenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'followups.manage'))
    return { error: 'You do not have permission to manage follow-up sequences.' };

  const parsed = z.object({ name: z.string().trim().min(1).max(200) }).safeParse({
    name: formData.get('name'),
  });
  if (!parsed.success) return { error: 'Invalid sequence.' };

  const supabase = await createSupabaseServerClient();
  const res = await createSequence(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    name: parsed.data.name,
  });
  revalidatePath('/automations/sequences');
  return res.ok ? { ok: true, id: res.id } : { error: res.error ?? 'Could not create sequence.' };
}

export async function updateSequenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'followups.manage'))
    return { error: 'You do not have permission to manage follow-up sequences.' };

  let steps: FollowUpStepInput[] | undefined;
  try {
    const raw = formData.get('steps');
    if (typeof raw === 'string' && raw.trim()) {
      const parsedSteps = z.array(stepSchema).max(20).safeParse(JSON.parse(raw));
      if (!parsedSteps.success) return { error: 'Invalid steps.' };
      steps = parsedSteps.data.map((s) => ({
        stepIndex: 0,
        delayHours: s.delayHours,
        channel: s.channel as FollowUpChannel,
        templateId: s.templateId ?? null,
        onlyScoreCategories: s.onlyScoreCategories,
      }));
    }
  } catch {
    return { error: 'Invalid steps payload.' };
  }

  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      quietStartHour: z.coerce.number().int().min(0).max(23),
      quietEndHour: z.coerce.number().int().min(0).max(23),
    })
    .safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
      quietStartHour: formData.get('quietStartHour'),
      quietEndHour: formData.get('quietEndHour'),
    });
  if (!parsed.success) return { error: 'Invalid sequence.' };

  // Unchecked checkboxes do not POST, so treat absence as `false`.
  const enabled = formData.get('enabled') === 'true';
  const stopOnReply = formData.get('stopOnReply') === 'true';

  const supabase = await createSupabaseServerClient();
  const res = await updateSequence(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    id: parsed.data.id,
    name: parsed.data.name,
    enabled,
    stopOnReply,
    quietStartHour: parsed.data.quietStartHour,
    quietEndHour: parsed.data.quietEndHour,
    steps,
  });
  revalidatePath(`/automations/sequences/${parsed.data.id}`);
  revalidatePath('/automations/sequences');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not update sequence.' };
}

export async function enrollLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'followups.manage'))
    return { error: 'You do not have permission to manage follow-up sequences.' };

  const parsed = z
    .object({ sequenceId: z.string().uuid(), leadId: z.string().uuid() })
    .safeParse({ sequenceId: formData.get('sequenceId'), leadId: formData.get('leadId') });
  if (!parsed.success) return { error: 'Invalid enrolment.' };

  const supabase = await createSupabaseServerClient();
  const res = await enrollLead(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    sequenceId: parsed.data.sequenceId,
    leadId: parsed.data.leadId,
  });
  revalidatePath(`/automations/sequences/${parsed.data.sequenceId}`);
  if (res.ok) return { ok: true, id: res.id };
  return {
    error: res.error === 'already_enrolled' ? 'That lead is already enrolled.' : 'Could not enrol.',
  };
}

export async function unenrollLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'followups.manage'))
    return { error: 'You do not have permission to manage follow-up sequences.' };

  const parsed = z
    .object({ enrollmentId: z.string().uuid(), sequenceId: z.string().uuid() })
    .safeParse({
      enrollmentId: formData.get('enrollmentId'),
      sequenceId: formData.get('sequenceId'),
    });
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const res = await unenrollLead(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    enrollmentId: parsed.data.enrollmentId,
  });
  revalidatePath(`/automations/sequences/${parsed.data.sequenceId}`);
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not unenrol.' };
}
