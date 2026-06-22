'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ACTIVE_TENANT_COOKIE } from '@/lib/auth';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Switch the active tenant. Validates membership, persists the choice as a
 * cookie, and writes `active_tenant` into the user's JWT app_metadata so RLS
 * (current_tenant_id()) resolves it over PostgREST. The client refreshes its
 * session afterwards to pick up the new claim.
 */
export async function setActiveTenantAction(tenantId: string): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // Verify the user is an active member of the target tenant (RLS-safe read).
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, tenant_id, roles(slug)')
    .eq('profile_id', user.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) {
    // Attempted switch to a tenant the user is not a member of — security event.
    await writeAudit({
      action: 'TENANT_SWITCH_DENIED',
      actorUserId: user.id,
      entityType: 'tenant',
      entityId: tenantId,
    });
    return { ok: false };
  }

  const admin = createSupabaseAdminClient();
  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { active_tenant: tenantId },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  const role = (membership.roles as unknown as { slug: string } | null)?.slug ?? null;
  await writeAudit({
    action: 'TENANT_SWITCH',
    tenantId,
    actorUserId: user.id,
    actorMembershipId: membership.id as string,
    actorRole: role,
    entityType: 'tenant',
    entityId: tenantId,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
