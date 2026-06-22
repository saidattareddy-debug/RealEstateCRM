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

const inviteSchema = z.object({
  email: z.string().email(),
  roleSlug: z.string().min(2).max(40),
});

export async function createInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'users.invite')) {
    return { error: 'You do not have permission to invite users.' };
  }
  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    roleSlug: formData.get('roleSlug'),
  });
  if (!parsed.success) return { error: 'Enter a valid email and role.' };

  const supabase = await createSupabaseServerClient();
  const { data: role } = await supabase
    .from('roles')
    .select('id')
    .eq('tenant_id', ctx.activeTenantId)
    .eq('slug', parsed.data.roleSlug)
    .maybeSingle();
  if (!role) return { error: 'Unknown role for this workspace.' };

  const token = crypto.randomUUID();
  const { data: inserted, error } = await supabase
    .from('invitations')
    .insert({
      tenant_id: ctx.activeTenantId,
      email: parsed.data.email,
      role_id: role.id as string,
      token,
      invited_by: ctx.userId,
    })
    .select('id')
    .maybeSingle();
  if (error) return { error: 'Could not create the invitation.' };

  await writeAudit({
    action: 'INVITATION_CREATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'invitation',
    entityId: (inserted?.id as string) ?? null,
    newValues: { email: parsed.data.email, role: parsed.data.roleSlug }, // token not logged
  });

  revalidatePath('/team');
  return { ok: true };
}
