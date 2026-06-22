'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAppContext } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { markRead, markAllRead } from '@/lib/notifications/service';

/**
 * Notification actions. Reading/marking a notification needs no extra permission
 * beyond an active tenant — RLS scopes every row to the recipient (auth.uid()),
 * so a user can only ever touch their own notifications.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function markReadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  const parsed = z.string().uuid().safeParse(formData.get('notificationId'));
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const res = await markRead(supabase, ctx.activeTenantId, ctx.userId, parsed.data);
  revalidatePath('/notifications');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not mark read.' };
}

export async function markAllReadAction(): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  const supabase = await createSupabaseServerClient();
  const res = await markAllRead(supabase, ctx.activeTenantId, ctx.userId);
  revalidatePath('/notifications');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not mark all read.' };
}
