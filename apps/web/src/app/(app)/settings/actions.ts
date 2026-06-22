'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { hexColorSchema } from '@re/validation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

const brandingSchema = z.object({
  primary_color: hexColorSchema,
  secondary_color: hexColorSchema,
  accent_color: hexColorSchema,
});

export async function updateBrandingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'settings.branding.manage')) {
    return { error: 'You do not have permission to update branding.' };
  }
  const parsed = brandingSchema.safeParse({
    primary_color: formData.get('primary_color'),
    secondary_color: formData.get('secondary_color'),
    accent_color: formData.get('accent_color'),
  });
  if (!parsed.success) return { error: 'Enter valid 6-digit hex colours.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('tenant_branding')
    .select('primary_color, secondary_color, accent_color')
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();

  const { error } = await supabase
    .from('tenant_branding')
    .update(parsed.data)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Update failed (permission or validation).' };

  await writeAudit({
    action: 'BRANDING_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'tenant_branding',
    entityId: ctx.activeTenantId,
    previousValues: before ?? null,
    newValues: parsed.data,
  });

  revalidatePath('/settings');
  return { ok: true };
}

const orgSchema = z.object({
  timezone: z.string().min(2).max(64),
  currency: z.string().length(3),
  audit_retention_days: z.coerce.number().int().min(30).max(3650),
});

export async function updateOrgSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'settings.org.manage')) {
    return { error: 'You do not have permission to update organisation settings.' };
  }
  const parsed = orgSchema.safeParse({
    timezone: formData.get('timezone'),
    currency: formData.get('currency'),
    audit_retention_days: formData.get('audit_retention_days'),
  });
  if (!parsed.success) return { error: 'Check the organisation settings values.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('tenant_settings')
    .select('timezone, currency, audit_retention_days')
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();

  const { error } = await supabase
    .from('tenant_settings')
    .update(parsed.data)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Update failed (permission or validation).' };

  await writeAudit({
    action: 'ORG_SETTINGS_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'tenant_settings',
    entityId: ctx.activeTenantId,
    previousValues: before ?? null,
    newValues: parsed.data,
  });

  revalidatePath('/settings');
  return { ok: true };
}
