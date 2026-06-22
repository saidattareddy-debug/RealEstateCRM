import type { NextRequest } from 'next/server';
import { widgetStartSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ingestLead } from '@/lib/leads/ingest';
import { widgetOriginAllowed, timestampWithinTolerance, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';
import { createWebsiteSession } from '@/lib/chat/session';

/**
 * POST /api/chat/[widgetId]/start — open (or resume) a website-chat session.
 * `widgetId` is the widget's public_key (safe to embed). Hardened like the
 * public lead form: origin allow-list, size cap, rate limit, timestamp window,
 * honeypot, consent. Returns ONLY an opaque session id — never internal tenant,
 * lead, or conversation identifiers, and never whether a contact already exists.
 *
 * The future AI responder (Phase 5) will pick up inbound messages from here;
 * for now the conversation simply lands in the human inbox.
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
    .select(
      'id, tenant_id, source_id, project_id, status, allowed_origins, rate_limit_per_min, consent_required',
    )
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
  if (!rateLimit(`chat:${widgetId}:${ip ?? 'anon'}`, (widget.rate_limit_per_min as number) ?? 30)) {
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

  const parsed = widgetStartSchema.safeParse(body);
  if (!parsed.success) return safeJson(422, 'invalid_payload', requestId);
  // Honeypot: any value means a bot — accept silently with a throwaway session.
  if (parsed.data.hp && parsed.data.hp.trim() !== '') {
    return Response.json({ ok: true, sessionId: crypto.randomUUID(), requestId }, { status: 202 });
  }
  if (widget.consent_required && parsed.data.consent !== true) {
    return safeJson(422, 'consent_required', requestId);
  }

  try {
    // Create/resolve the lead idempotently (form-kind inbound).
    const res = await ingestLead(
      tenantId,
      {
        fullName: parsed.data.fullName ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        preferredLanguage: parsed.data.language ?? null,
        campaign: parsed.data.campaign ?? null,
        source: 'website_chat',
        utm: parsed.data.utm,
      },
      { sourceKind: 'form', correlationId: requestId },
    );

    // A per-session external thread id keeps the conversation idempotent.
    const threadId = crypto.randomUUID();
    const { data: conv } = await admin
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        lead_id: res.leadId,
        channel: 'website_chat',
        status: 'open',
        language: parsed.data.language ?? null,
        widget_id: widget.id,
        external_thread_id: threadId,
        ai_active: true,
      })
      .select('id')
      .single();
    if (!conv) return safeJson(500, 'chat_start_failed', requestId);

    // Mint the authoritative website session (opaque token; only its hash is stored).
    const issued = await createWebsiteSession(admin, {
      tenantId,
      widgetId: widget.id,
      conversationId: conv.id,
      language: parsed.data.language ?? null,
      projectContext: (widget.project_id as string | null) ?? null,
      pageContext: parsed.data.pageUrl ?? null,
      utm: parsed.data.utm ?? null,
      consentState: parsed.data.consent ? 'granted' : null,
    });
    if (!issued) return safeJson(500, 'chat_start_failed', requestId);

    if (parsed.data.message && parsed.data.message.trim() !== '') {
      // The conversation trigger maintains waiting-on/last-message/delivery.
      await admin.from('conversation_messages').insert({
        tenant_id: tenantId,
        conversation_id: conv.id,
        lead_id: res.leadId,
        direction: 'inbound',
        sender: 'lead',
        body: parsed.data.message,
        language: parsed.data.language ?? null,
        status: 'received',
        metadata: { page_url: parsed.data.pageUrl ?? null },
      });
    }

    // Return ONLY the opaque token + public session id — no internal ids leak.
    return Response.json(
      { ok: true, token: issued.token, sessionId: issued.publicSessionId, requestId },
      { status: 201 },
    );
  } catch {
    return safeJson(500, 'chat_start_failed', requestId);
  }
}
