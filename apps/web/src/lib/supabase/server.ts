import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getClientEnv } from '@re/config';

/**
 * Server-side Supabase client bound to the user's session cookies.
 * Runs as the authenticated user, so RLS + auth.uid() apply. Use this for all
 * first-party reads/writes (docs/SECURITY.md §3).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getClientEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only;
          // the middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
