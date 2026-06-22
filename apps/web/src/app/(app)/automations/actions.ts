'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  type ActionType,
  type AutomationTrigger,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createAutomation,
  updateAutomation,
  deleteAutomation,
  toggleAutomation,
  type AutomationActionInput,
} from '@/lib/automations/service';

/**
 * Phase 8 automations server actions. Each enforces getAppContext +
 * ensurePermission('automations.manage'); RLS re-checks server-side. Customer-send
 * actions configured here are only ever RECORDED suppressed by the runner — these
 * actions never trigger a live send.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

const triggerSchema = z.enum(AUTOMATION_TRIGGERS);
const actionTypeSchema = z.enum(ACTION_TYPES);

const actionsSchema = z
  .array(z.object({ type: actionTypeSchema, params: z.record(z.string(), z.unknown()).optional() }))
  .max(20);

export async function createAutomationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'automations.manage'))
    return { error: 'You do not have permission to manage automations.' };

  const parsed = z
    .object({ name: z.string().trim().min(1).max(200), trigger: triggerSchema })
    .safeParse({ name: formData.get('name'), trigger: formData.get('trigger') });
  if (!parsed.success) return { error: 'Invalid automation.' };

  const supabase = await createSupabaseServerClient();
  const res = await createAutomation(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    name: parsed.data.name,
    trigger: parsed.data.trigger as AutomationTrigger,
  });
  revalidatePath('/automations');
  return res.ok ? { ok: true, id: res.id } : { error: res.error ?? 'Could not create automation.' };
}

export async function toggleAutomationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'automations.manage'))
    return { error: 'You do not have permission to manage automations.' };

  const parsed = z
    .object({ automationId: z.string().uuid(), enabled: z.enum(['true', 'false']) })
    .safeParse({ automationId: formData.get('automationId'), enabled: formData.get('enabled') });
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const res = await toggleAutomation(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    automationId: parsed.data.automationId,
    enabled: parsed.data.enabled === 'true',
  });
  revalidatePath('/automations');
  revalidatePath(`/automations/${parsed.data.automationId}`);
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not update automation.' };
}

export async function updateAutomationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'automations.manage'))
    return { error: 'You do not have permission to manage automations.' };

  // `conditionGroup` and `actions` arrive as JSON strings from the client form.
  let conditionGroup: unknown = undefined;
  let actions: AutomationActionInput[] | undefined = undefined;
  try {
    const cgRaw = formData.get('conditionGroup');
    if (typeof cgRaw === 'string' && cgRaw.trim()) conditionGroup = JSON.parse(cgRaw);
    const actRaw = formData.get('actions');
    if (typeof actRaw === 'string' && actRaw.trim()) {
      const parsedActions = actionsSchema.safeParse(JSON.parse(actRaw));
      if (!parsedActions.success) return { error: 'Invalid actions.' };
      actions = parsedActions.data.map((a) => ({
        type: a.type as ActionType,
        params: (a.params as Record<string, unknown>) ?? {},
      }));
    }
  } catch {
    return { error: 'Invalid automation payload.' };
  }

  const parsed = z
    .object({
      automationId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      trigger: triggerSchema,
      maxRunsPerLead: z.coerce.number().int().positive().nullable().optional(),
    })
    .safeParse({
      automationId: formData.get('automationId'),
      name: formData.get('name'),
      trigger: formData.get('trigger'),
      maxRunsPerLead: (formData.get('maxRunsPerLead') as string) || null,
    });
  if (!parsed.success) return { error: 'Invalid automation.' };

  const supabase = await createSupabaseServerClient();
  const res = await updateAutomation(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    automationId: parsed.data.automationId,
    name: parsed.data.name,
    trigger: parsed.data.trigger as AutomationTrigger,
    maxRunsPerLead: parsed.data.maxRunsPerLead ?? null,
    conditionGroup: (conditionGroup as never) ?? null,
    actions,
  });
  revalidatePath(`/automations/${parsed.data.automationId}`);
  revalidatePath('/automations');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not update automation.' };
}

export async function deleteAutomationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'automations.manage'))
    return { error: 'You do not have permission to manage automations.' };

  const parsed = z.string().uuid().safeParse(formData.get('automationId'));
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const res = await deleteAutomation(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    automationId: parsed.data,
  });
  revalidatePath('/automations');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not delete automation.' };
}
