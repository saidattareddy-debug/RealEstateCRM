import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getClientEnv, getServerEnv } from '@re/config';

/**
 * SERVICE-ROLE client. SERVER-ONLY — never import into client code.
 * Bypasses RLS, so every caller MUST enforce tenant + permission itself.
 * Used for platform provisioning (tenant creation) and the active-tenant
 * switch (updating JWT app_metadata). See docs/SECURITY.md §4.
 */
export function createSupabaseAdminClient() {
  const pub = getClientEnv();
  const srv = getServerEnv();
  return createClient(pub.NEXT_PUBLIC_SUPABASE_URL, srv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
