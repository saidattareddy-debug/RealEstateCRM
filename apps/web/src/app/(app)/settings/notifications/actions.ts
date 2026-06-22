'use server';

import { revalidatePath } from 'next/cache';
import { NOTIFICATION_KINDS } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { updatePreferences } from '@/lib/notifications/service';

/**
 * Notification-preferences action. Gated by `notifications.manage`; RLS scopes the
 * preferences row to the caller (user_id = auth.uid()). No external IO.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function updatePreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'notifications.manage'))
    return { error: 'You do not have permission to manage notification preferences.' };

  const mutedKinds = NOTIFICATION_KINDS.filter((k) => formData.get(`muted_${k}`) === 'on');

  const supabase = await createSupabaseServerClient();
  const res = await updatePreferences(supabase, {
    tenantId: ctx.activeTenantId,
    userId: ctx.userId,
    emailEnabled: formData.get('emailEnabled') === 'on',
    pushEnabled: formData.get('pushEnabled') === 'on',
    quietHoursEnabled: formData.get('quietHoursEnabled') === 'on',
    mutedKinds: [...mutedKinds],
  });
  revalidatePath('/settings/notifications');
  return res.ok ? { ok: true } : { error: res.error ?? 'Could not save preferences.' };
}
