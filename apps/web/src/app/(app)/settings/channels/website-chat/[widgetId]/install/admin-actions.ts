'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { sha256Hex } from '@/lib/leads/security';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

async function authorize() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'website_chat.manage')) return null;
  return ctx;
}

/** Pause / resume the widget (status). Admin operation, audited. */
export async function setWidgetStatusAction(
  widgetId: string,
  status: 'active' | 'paused',
): Promise<ActionState> {
  const ctx = await authorize();
  if (!ctx) return { error: 'You do not have permission.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('website_chat_widgets')
    .update({ status })
    .eq('id', widgetId)
    .eq('tenant_id', ctx.activeTenantId!);
  if (error) return { error: 'Could not update the widget.' };
  await writeAudit({
    action: 'WIDGET_CONFIG_UPDATE',
    tenantId: ctx.activeTenantId!,
    actorUserId: ctx.userId,
    entityType: 'website_chat_widget',
    entityId: widgetId,
    newValues: { status },
  });
  revalidatePath(`/settings/channels/website-chat/${widgetId}/install`);
  return { ok: true };
}

/**
 * Revoke ALL active visitor sessions for the widget (end them). This is a
 * widget-level administrative action — distinct from automatic per-visitor token
 * rotation, which the session service handles on its own.
 */
export async function revokeAllWidgetSessionsAction(widgetId: string): Promise<ActionState> {
  const ctx = await authorize();
  if (!ctx) return { error: 'You do not have permission.' };
  // Verify the widget belongs to the tenant under RLS first.
  const supabase = await createSupabaseServerClient();
  const { data: widget } = await supabase
    .from('website_chat_widgets')
    .select('id')
    .eq('id', widgetId)
    .maybeSingle();
  if (!widget) return { error: 'Widget not found.' };

  const admin = createSupabaseAdminClient();
  await admin
    .from('website_chat_sessions')
    .update({ status: 'ended' })
    .eq('tenant_id', ctx.activeTenantId!)
    .eq('widget_id', widgetId)
    .eq('status', 'active');
  await writeAudit({
    action: 'WIDGET_CONFIG_UPDATE',
    tenantId: ctx.activeTenantId!,
    actorUserId: ctx.userId,
    entityType: 'website_chat_widget',
    entityId: widgetId,
    newValues: { action: 'revoke_all_sessions' },
  });
  revalidatePath(`/settings/channels/website-chat/${widgetId}/install`);
  return { ok: true };
}

/**
 * Rotate the widget installation secret (hashed only). Separate from per-visitor
 * token rotation. Returns the new secret ONCE for the admin to copy.
 */
export async function rotateWidgetCredentialAction(
  widgetId: string,
): Promise<ActionState & { secret?: string }> {
  const ctx = await authorize();
  if (!ctx) return { error: 'You do not have permission.' };
  const secret = randomBytes(24).toString('base64url');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('website_chat_widgets')
    .update({ secret_hash: sha256Hex(secret), rotated_at: new Date().toISOString() })
    .eq('id', widgetId)
    .eq('tenant_id', ctx.activeTenantId!);
  if (error) return { error: 'Could not rotate the credential.' };
  await writeAudit({
    action: 'WIDGET_CONFIG_UPDATE',
    tenantId: ctx.activeTenantId!,
    actorUserId: ctx.userId,
    entityType: 'website_chat_widget',
    entityId: widgetId,
    newValues: { action: 'rotate_credential' }, // never log the secret
  });
  revalidatePath(`/settings/channels/website-chat/${widgetId}/install`);
  return { ok: true, secret };
}
