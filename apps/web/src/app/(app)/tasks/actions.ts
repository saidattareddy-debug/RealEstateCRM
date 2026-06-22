'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  leadId: z.string().uuid().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'tasks.manage')) {
    return { error: 'You do not have permission to manage tasks.' };
  }
  const parsed = createTaskSchema.safeParse({
    title: formData.get('title'),
    leadId: formData.get('leadId') || null,
    dueAt: formData.get('dueAt') || null,
    assigneeId: formData.get('assigneeId') || null,
  });
  if (!parsed.success) return { error: 'Enter a task title.' };

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from('tasks')
    .insert({
      tenant_id: ctx.activeTenantId,
      title: parsed.data.title,
      lead_id: parsed.data.leadId ?? null,
      due_at: parsed.data.dueAt ? new Date(parsed.data.dueAt).toISOString() : null,
      assignee_id: parsed.data.assigneeId ?? ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .maybeSingle();
  if (error) return { error: 'Could not create task.' };

  await writeAudit({
    action: 'TASK_CREATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'task',
    entityId: (inserted?.id as string) ?? null,
    newValues: { title: parsed.data.title, leadId: parsed.data.leadId ?? null },
  });

  revalidatePath('/tasks');
  if (parsed.data.leadId) revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

export async function setTaskStatusAction(
  taskId: string,
  status: 'open' | 'done' | 'cancelled',
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'tasks.manage')) {
    return { error: 'You do not have permission to manage tasks.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', taskId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update task.' };
  revalidatePath('/tasks');
  return { ok: true };
}
