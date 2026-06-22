import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { decodeCursor, encodeCursor, isAfterCursor } from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { widgetOriginAllowed, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';
import { resolveWebsiteSession } from '@/lib/chat/session';

const schema = z.object({
  token: z.string().min(16).max(200),
  cursor: z.string().max(400).optional().nullable(),
  /** When provided, marks the visitor's last-read outbound message. */
  ackMessageId: z.string().uuid().optional().nullable(),
});

/**
 * POST /api/chat/[widgetId]/messages — token-scoped visitor polling + read.
 *
 * The visitor sends ONLY their opaque session token; the conversation is
 * resolved from it (never trusted from the browser). Returns messages after an
 * opaque cursor (redacted bodies replaced); optionally records the visitor's
 * last-acknowledged outbound message + unread outbound count on the session.
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
  const selfOrigin = new URL(req.url).origin;
  if (!widgetOriginAllowed((widget.allowed_origins as string[]) ?? [], origin, selfOrigin)) {
    return safeJson(403, 'forbidden', requestId);
  }
  if (
    !rateLimit(`chatpoll:${widgetId}:${ip ?? 'anon'}`, (widget.rate_limit_per_min as number) ?? 60)
  ) {
    return safeJson(429, 'rate_limited', requestId);
  }

  const raw = await req.text();
  if (raw.length > 2_048) return safeJson(413, 'payload_too_large', requestId);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return safeJson(422, 'invalid_payload', requestId);

  const session = await resolveWebsiteSession(admin, {
    tenantId,
    widgetId: widget.id,
    token: parsed.data.token,
  });
  if (!session || !session.conversationId) return safeJson(401, 'invalid_session', requestId);

  // Visitor read-state lives on the session row.
  const { data: sessRow } = await admin
    .from('website_chat_sessions')
    .select('visitor_last_read_at')
    .eq('id', session.id)
    .maybeSingle();
  const visitorLastReadAt = (sessRow?.visitor_last_read_at as string | null) ?? null;

  const pos = decodeCursor(parsed.data.cursor ?? null);
  const { data } = await admin
    .from('conversation_messages')
    .select('id, direction, sender, body, redacted, created_at')
    .eq('conversation_id', session.conversationId)
    .neq('direction', 'internal') // visitors never see internal notes
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(51);

  const rows = (data ?? [])
    .filter((m) => isAfterCursor({ createdAt: m.created_at as string, id: m.id as string }, pos))
    .slice(0, 50)
    .map((m) => ({
      id: m.id as string,
      direction: m.direction as string,
      from: m.sender === 'lead' ? 'you' : 'agent',
      body: m.redacted ? '[redacted]' : ((m.body as string | null) ?? ''),
      createdAt: m.created_at as string,
    }));

  // Record the visitor's last-acknowledged outbound message + read time.
  let ackAt = visitorLastReadAt;
  if (parsed.data.ackMessageId) {
    ackAt = new Date().toISOString();
    await admin
      .from('website_chat_sessions')
      .update({
        visitor_last_acked_message_id: parsed.data.ackMessageId,
        visitor_last_read_at: ackAt,
        last_seen_at: ackAt,
      })
      .eq('id', session.id);
  }
  // Unread = outbound (agent/ai) messages created after the visitor's read time.
  let unreadQuery = admin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', session.conversationId)
    .eq('direction', 'outbound');
  if (ackAt) unreadQuery = unreadQuery.gt('created_at', ackAt);
  const { count: unread } = await unreadQuery;

  const last = rows[rows.length - 1];
  return Response.json(
    {
      ok: true,
      messages: rows,
      nextCursor: last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : (parsed.data.cursor ?? null),
      unread: unread ?? 0,
      requestId,
    },
    { status: 200 },
  );
}
