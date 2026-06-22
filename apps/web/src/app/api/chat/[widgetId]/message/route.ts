import type { NextRequest } from 'next/server';
import { widgetMessageSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  widgetOriginAllowed,
  timestampWithinTolerance,
  safeJson,
  sha256Hex,
} from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';
import { resolveWebsiteSession } from '@/lib/chat/session';
import { ingestConversationMessage } from '@/lib/conversations/ingest-message';
import { runResponder } from '@/lib/ai/responder';

/**
 * POST /api/chat/[widgetId]/message — append an inbound message to an existing
 * website-chat session. Idempotent on (tenant, conversation, clientMessageId).
 * Same hardening as /start. Returns a non-disclosing ack only.
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
  const ts = req.headers.get('x-timestamp');
  if (ts && !timestampWithinTolerance(ts)) return safeJson(401, 'stale_request', requestId);
  if (
    !rateLimit(`chatmsg:${widgetId}:${ip ?? 'anon'}`, (widget.rate_limit_per_min as number) ?? 60)
  ) {
    return safeJson(429, 'rate_limited', requestId);
  }

  const raw = await req.text();
  if (raw.length > 8_192) return safeJson(413, 'payload_too_large', requestId);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }

  const parsed = widgetMessageSchema.safeParse(body);
  if (!parsed.success) return safeJson(422, 'invalid_payload', requestId);
  if (parsed.data.hp && parsed.data.hp.trim() !== '') {
    return Response.json({ ok: true, requestId }, { status: 202 });
  }

  // Resolve the conversation from the OPAQUE TOKEN only (scoped to widget +
  // tenant). A modified / rotated / expired / cross-widget / cross-tenant token
  // cannot resolve. The browser supplies no internal identifiers.
  const session = await resolveWebsiteSession(admin, {
    tenantId,
    widgetId: widget.id,
    token: parsed.data.token,
  });
  if (!session || !session.conversationId) return safeJson(401, 'invalid_session', requestId);
  const { data: conv } = await admin
    .from('conversations')
    .select('id, lead_id, status, operating_mode')
    .eq('id', session.conversationId)
    .maybeSingle();
  if (!conv || conv.status === 'closed') return safeJson(404, 'not_found', requestId);

  // Persist-before-process via the CANONICAL conversation-ingestion service (the
  // single shared path used by website chat + integration channels). It records
  // a durable ingestion event (idempotent), inserts the message (the DB trigger
  // emits the delivery event + recomputes waiting-on), and recomputes SLA.
  const idemKey = parsed.data.clientMessageId ?? sha256Hex(`${session.id}:${parsed.data.body}`);
  const payloadHash = sha256Hex(parsed.data.body);
  const res = await ingestConversationMessage(
    {
      tenantId,
      conversationId: conv.id as string,
      leadId: (conv.lead_id as string | null) ?? null,
      widgetId: widget.id as string,
      body: parsed.data.body,
      language: parsed.data.language ?? null,
      externalMessageId: parsed.data.clientMessageId ?? null,
      idempotencyKey: idemKey,
      payloadHash,
      correlationId: requestId,
    },
    admin,
  );
  if (!res.ok) return safeJson(500, 'message_failed', requestId);
  // Duplicate authenticated message → idempotent success, no second message.
  if (res.duplicate) return Response.json({ ok: true, requestId }, { status: 202 });

  // Phase 5B (behind the safety boundary): on an AI-mode conversation, let the
  // responder RECORD what it would do. It never sends — delivery is impossible
  // (`RESPONDER_LIVE_SENDING = false` + a DB CHECK forbidding the `deliver`
  // outcome). Isolated so a responder failure can never break the inbound ack.
  if (conv.operating_mode === 'ai') {
    try {
      await runResponder(conv.id as string, tenantId, admin);
    } catch {
      // Non-fatal: the customer message is already durably recorded.
    }
  }
  return Response.json({ ok: true, requestId }, { status: 202 });
}
