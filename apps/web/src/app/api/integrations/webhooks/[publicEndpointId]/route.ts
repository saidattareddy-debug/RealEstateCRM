import type { NextRequest } from 'next/server';
import { publicWebhooksEnabled } from '@re/config';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { safeJson } from '@/lib/leads/security';
import { ingestWebhook, resolveEndpointByPublicId } from '@/lib/integrations/ingest';
import { secretRefConfigured } from '@/lib/integrations/secrets';

/**
 * Opaque public webhook endpoint (Phase 7A — record-only). Providers post to
 * `/api/integrations/webhooks/<publicEndpointId>`, where `publicEndpointId` is a
 * random, rotatable identifier (`channel_webhook_endpoints.public_id`) that is
 * NOT derived from any tenant or connection id. The tenant + integration are
 * resolved server-side from that endpoint, NEVER from the request body. A
 * revoked/unknown endpoint fails generically (no tenant-existence disclosure).
 * Phase 7A performs no external IO and sends nothing — it only RECORDS
 * normalized events through the existing ingestion services.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 1_000_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ publicEndpointId: string }> },
) {
  const { publicEndpointId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  if (!publicWebhooksEnabled()) return safeJson(404, 'not_found', requestId);
  const admin = createSupabaseAdminClient();

  const endpoint = await resolveEndpointByPublicId(admin, publicEndpointId);
  if (!endpoint || endpoint.disabled || !endpoint.endpointActive) {
    return safeJson(404, 'not_found', requestId);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expected = endpoint.verificationTokenRef
    ? (process.env[endpoint.verificationTokenRef] ?? null)
    : null;
  if (mode === 'subscribe' && expected && token && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return safeJson(403, 'forbidden', requestId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ publicEndpointId: string }> },
) {
  const { publicEndpointId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  // Phase-7A public-webhook gate (default OFF). Reject provider POSTs generically
  // while disabled — no tenant/endpoint disclosure. Internal fixtures are unaffected.
  if (!publicWebhooksEnabled()) return safeJson(404, 'not_found', requestId);

  const admin = createSupabaseAdminClient();

  const endpoint = await resolveEndpointByPublicId(admin, publicEndpointId);
  if (!endpoint) return safeJson(404, 'not_found', requestId);

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY) return safeJson(413, 'payload_too_large', requestId);

  if (endpoint.requiresSignature && !secretRefConfigured(endpoint.secretRef)) {
    return safeJson(401, 'unauthorized', requestId);
  }

  const headers: Record<string, string | undefined> = {
    'content-type': req.headers.get('content-type') ?? undefined,
  };
  const providedSignature =
    req.headers.get('x-hub-signature-256')?.replace(/^sha256=/, '') ??
    req.headers.get('x-signature-256')?.replace(/^sha256=/, '') ??
    undefined;
  const timestamp = req.headers.get('x-timestamp') ?? undefined;

  const outcome = await ingestWebhook({
    endpoint,
    raw: { method: req.method, headers, rawBody, receivedAt: new Date().toISOString() },
    providedSignature,
    timestamp,
    correlationId: requestId,
  });

  if (!outcome.ok && outcome.status === 'rejected') {
    return safeJson(401, 'rejected', requestId);
  }
  return Response.json({ ok: true, requestId }, { status: 202 });
}
