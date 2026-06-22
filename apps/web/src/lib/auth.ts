import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { PermissionKey } from '@re/validation';
import { hasPermission } from '@re/domain';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const ACTIVE_TENANT_COOKIE = 'active_tenant';

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  roleSlug: string;
  roleName: string;
}

export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  whiteLabel: boolean;
}

export interface AppContext {
  userId: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  memberships: MembershipSummary[];
  activeTenantId: string | null;
  branding: Branding | null;
  permissions: Set<PermissionKey>;
}

/**
 * Load the full server-side context, or redirect to sign-in if unauthenticated.
 * Wrapped in React `cache()` so it computes ONCE per request even though both the
 * layout and the page call it — and its independent queries run in parallel to
 * minimise round-trips to Supabase.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // Profile + memberships are independent — fetch them concurrently.
  const [{ data: profile }, { data: membershipRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, full_name, is_platform_admin')
      .eq('id', user.id)
      .single(),
    supabase
      .from('memberships')
      .select('tenant_id, tenants(name, slug), roles(slug, name)')
      .eq('profile_id', user.id)
      .eq('status', 'active'),
  ]);

  const memberships: MembershipSummary[] = (membershipRows ?? []).map((m) => {
    const tenant = m.tenants as unknown as { name: string; slug: string } | null;
    const role = m.roles as unknown as { slug: string; name: string } | null;
    return {
      tenantId: m.tenant_id as string,
      tenantName: tenant?.name ?? 'Unknown',
      tenantSlug: tenant?.slug ?? '',
      roleSlug: role?.slug ?? '',
      roleName: role?.name ?? '',
    };
  });

  const cookieStore = await cookies();
  const cookieTenant = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  const activeTenantId =
    memberships.find((m) => m.tenantId === cookieTenant)?.tenantId ??
    memberships[0]?.tenantId ??
    null;

  let branding: Branding | null = null;
  const permissions = new Set<PermissionKey>();

  if (activeTenantId) {
    // Branding + effective permissions are independent — fetch concurrently.
    const [{ data: brandingRow }, { data: perms }] = await Promise.all([
      supabase
        .from('tenant_branding')
        .select('primary_color, secondary_color, accent_color, logo_url, white_label')
        .eq('tenant_id', activeTenantId)
        .maybeSingle(),
      supabase.rpc('effective_permissions', {
        p_profile: user.id,
        p_tenant: activeTenantId,
      }),
    ]);
    if (brandingRow) {
      branding = {
        primaryColor: brandingRow.primary_color as string,
        secondaryColor: brandingRow.secondary_color as string,
        accentColor: brandingRow.accent_color as string,
        logoUrl: (brandingRow.logo_url as string | null) ?? null,
        whiteLabel: Boolean(brandingRow.white_label),
      };
    }
    for (const row of (perms ?? []) as { permission_key: string }[]) {
      permissions.add(row.permission_key as PermissionKey);
    }
  }

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? '',
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    memberships,
    activeTenantId,
    branding,
    permissions,
  };
});

/** Guard a server component/action by a required permission. */
export function ensurePermission(ctx: AppContext, required: PermissionKey): boolean {
  return hasPermission(ctx.permissions, required);
}
