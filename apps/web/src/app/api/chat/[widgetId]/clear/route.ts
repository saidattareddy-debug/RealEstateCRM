import type { NextRequest } from 'next/server';
import { widgetClearSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { widgetOriginAllowed, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';
import { resolveWebsiteSession, endWebsiteSession } from '@/lib/chat/session';

/**
 * POST /api/chat/[widgetId]/clear — clear-chat. Ends the session bound to the
 * supplied opaque token so it can never be resumed. Non-disclosing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ widgetId: string }> },
) {
  const { widgetId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const origin = req.headers.get('origin');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const admin = createSupabaseAdminClient();

  const { data: widget } = await admin
    .from('website_chat_widgets')
    .select('id, tenant_id, status, allowed_origins, rate_limit_per_min')
    .eq('public_key', widgetId)
    .maybeSingle();
  if (!widget || widget.status !== 'active') return safeJson(404, 'not_found', requestId);
  const tenantId = widget.tenant_id as string;
  if (
    !widgetOriginAllowed(
      (widget.allowed_origins as string[]) ?? [],
      origin,
      new URL(req.url).origin,
    )
  ) {
    return safeJson(403, 'forbidden', requestId);
  }
  if (
    !rateLimit(`chatclear:${widgetId}:${ip ?? 'anon'}`, (widget.rate_limit_per_min as number) ?? 30)
  ) {
    return safeJson(429, 'rate_limited', requestId);
  }

  const raw = await req.text();
  if (raw.length > 2_048) return safeJson(413, 'payload_too_large', requestId);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }
  const parsed = widgetClearSchema.safeParse(body);
  if (!parsed.success) return safeJson(422, 'invalid_payload', requestId);
  if (parsed.data.hp && parsed.data.hp.trim() !== '') {
    return Response.json({ ok: true, requestId }, { status: 202 });
  }

  const session = await resolveWebsiteSession(admin, {
    tenantId,
    widgetId: widget.id,
    token: parsed.data.token,
  });
  // Always ack the same way whether or not the token was valid (non-disclosing).
  if (session) await endWebsiteSession(admin, session.id);
  return Response.json({ ok: true, requestId }, { status: 202 });
}
