import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getClientEnv } from '@re/config';

/**
 * Refreshes the Supabase auth session on every request (required by
 * @supabase/ssr) and gates the authenticated app area. Also forwards the
 * request host so server code can resolve a tenant by custom domain.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/sign-in') || pathname.startsWith('/auth');
  // Public ingestion endpoints carry their own credential auth (form id + key /
  // signature), not a user session.
  const isPublic =
    isAuthRoute ||
    pathname.startsWith('/forms') ||
    pathname.startsWith('/chat') ||
    pathname === '/widget.js' ||
    pathname.startsWith('/webhooks') ||
    pathname.startsWith('/api/');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    return NextResponse.redirect(url);
  }

  response.headers.set('x-tenant-host', request.headers.get('host') ?? '');
  return response;
}
