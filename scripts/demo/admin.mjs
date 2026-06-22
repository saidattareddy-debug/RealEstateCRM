/**
 * Service-role admin client for the CLI (mirrors
 * apps/web/src/lib/supabase/admin.ts). SERVER-ONLY: this is only ever loaded by
 * the Node CLI, never bundled for the browser. The service-role key is read
 * from the environment and NEVER printed.
 */

export async function createCliAdminClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (server-only; never printed)');
  // Lazy import so the safety gate can refuse BEFORE any client dependency loads.
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Resolve + validate the target tenant. Refuses if missing (unless allowed). */
export async function resolveTenant(admin, { tenantArg, allowCreate }) {
  const { NORTHWIND_TENANT_ID, NORTHWIND_SLUGS } = await import('./safety.mjs');
  // Prefer resolving by id (the seed tenant), then by slug.
  const byId = await admin
    .from('tenants')
    .select('id, slug, name')
    .eq('id', NORTHWIND_TENANT_ID)
    .maybeSingle();
  if (byId.data) return byId.data;

  if (tenantArg) {
    const bySlug = await admin
      .from('tenants')
      .select('id, slug, name')
      .eq('slug', tenantArg)
      .maybeSingle();
    if (bySlug.data) return bySlug.data;
    if (NORTHWIND_SLUGS.includes(tenantArg)) {
      const alt = await admin
        .from('tenants')
        .select('id, slug, name')
        .in('slug', NORTHWIND_SLUGS)
        .maybeSingle();
      if (alt.data) return alt.data;
    }
  }
  if (!allowCreate) {
    throw new Error(
      `Target tenant not found (looked up id ${NORTHWIND_TENANT_ID} and slug "${tenantArg ?? ''}"). ` +
        'Pass --create-tenant to create it, or point at the correct staging database.',
    );
  }
  return null;
}
