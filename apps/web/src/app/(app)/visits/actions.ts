'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { VISIT_STATES, type VisitState } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { scheduleVisit, transitionVisitState, recordOutcome } from '@/lib/visits/service';

/**
 * Phase 8 site-visit server actions. Each enforces getAppContext +
 * ensurePermission('sitevisits.manage'); RLS re-checks server-side. Scheduling
 * surfaces double-booking conflicts (computed by the PURE engine) back to the UI.
 * Calendar stays simulation-only — no network IO.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
  conflicts?: { start: string; end: string; source: string }[];
}

const stateSchema = z.enum(VISIT_STATES);

export async function scheduleVisitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'sitevisits.manage'))
    return { error: 'You do not have permission to manage site visits.' };

  const parsed = z
    .object({
      leadId: z.string().uuid(),
      agentId: z.string().uuid(),
      projectId: z.string().uuid().nullable().optional(),
      scheduledStart: z.string().min(1),
      scheduledEnd: z.string().min(1),
      location: z.string().trim().max(500).optional(),
      notes: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      leadId: formData.get('leadId'),
      agentId: formData.get('agentId'),
      projectId: (formData.get('projectId') as string) || null,
      scheduledStart: formData.get('scheduledStart'),
      scheduledEnd: formData.get('scheduledEnd'),
      location: (formData.get('location') as string) || undefined,
      notes: (formData.get('notes') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid visit.' };

  const start = new Date(parsed.data.scheduledStart);
  const end = new Date(parsed.data.scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start)
    return { error: 'End must be after start.' };

  const supabase = await createSupabaseServerClient();
  const res = await scheduleVisit(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    leadId: parsed.data.leadId,
    agentId: parsed.data.agentId,
    projectId: parsed.data.projectId ?? null,
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    location: parsed.data.location ?? null,
    notes: parsed.data.notes ?? null,
  });
  revalidatePath('/visits');
  if (res.ok) return { ok: true, id: res.id };
  if (res.conflict)
    return {
      error: 'That agent is already booked in this window.',
      conflicts: (res.conflicts ?? []).map((c) => ({
        start: c.start,
        end: c.end,
        source: c.source,
      })),
    };
  return { error: res.error ?? 'Could not schedule the visit.' };
}

export async function transitionVisitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'sitevisits.manage'))
    return { error: 'You do not have permission to manage site visits.' };

  const parsed = z
    .object({
      visitId: z.string().uuid(),
      toState: stateSchema,
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse({
      visitId: formData.get('visitId'),
      toState: formData.get('toState'),
      reason: (formData.get('reason') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid transition.' };

  const supabase = await createSupabaseServerClient();
  const res = await transitionVisitState(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    visitId: parsed.data.visitId,
    toState: parsed.data.toState as VisitState,
    reason: parsed.data.reason ?? null,
  });
  revalidatePath('/visits');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not transition the visit.' };
}

export async function recordOutcomeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'sitevisits.manage'))
    return { error: 'You do not have permission to manage site visits.' };

  const parsed = z
    .object({
      visitId: z.string().uuid(),
      attended: z.enum(['true', 'false']),
      interestLevel: z.enum(['high', 'medium', 'low']).nullable().optional(),
      feedback: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      visitId: formData.get('visitId'),
      attended: formData.get('attended'),
      interestLevel: (formData.get('interestLevel') as string) || null,
      feedback: (formData.get('feedback') as string) || undefined,
    });
  if (!parsed.success) return { error: 'Invalid outcome.' };

  const supabase = await createSupabaseServerClient();
  const res = await recordOutcome(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    visitId: parsed.data.visitId,
    attended: parsed.data.attended === 'true',
    interestLevel: parsed.data.interestLevel ?? null,
    feedback: parsed.data.feedback ?? null,
  });
  revalidatePath('/visits');
  if (res.ok) return { ok: true };
  return {
    error:
      res.error === 'outcome_exists'
        ? 'An outcome was already recorded for this visit.'
        : 'Could not record the outcome.',
  };
}
