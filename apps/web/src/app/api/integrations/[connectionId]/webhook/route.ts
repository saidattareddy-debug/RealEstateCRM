import type { NextRequest } from 'next/server';
import { publicWebhooksEnabled } from '@re/config';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { safeJson } from '@/lib/leads/security';
import { ingestWebhook, resolveEndpointByConnection } from '@/lib/integrations/ingest';
import { secretRefConfigured } from '@/lib/integrations/secrets';

/**
 * Mock webhook endpoint (Phase 7A — record-only). The tenant + integration are
 * resolved from the connectionId path and its configured endpoint, NEVER from the
 * request body. Phase 7A performs no external IO and sends nothing; this route
 * only RECORDS normalized events through the existing ingestion services. The
 * response is a non-disclosing generic ack and never echoes secrets.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 1_000_000;

/**
 * GET — verification-token challenge (providers that use a hub.challenge style
 * handshake). We compare against the verification-token reference resolved
 * server-side and echo back only the provided challenge when it matches.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  if (!publicWebhooksEnabled()) return safeJson(404, 'not_found', requestId);
  const admin = createSupabaseAdminClient();

  const endpoint = await resolveEndpointByConnection(admin, connectionId);
  if (!endpoint || endpoint.disabled || !endpoint.endpointActive) {
    return safeJson(404, 'not_found', requestId);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  // The verification token is resolved from the secret-ref (env) and never logged
  // or returned. We only confirm equality, then echo the provider's challenge.
  const expected = endpoint.verificationTokenRef
    ? (process.env[endpoint.verificationTokenRef] ?? null)
    : null;
  if (mode === 'subscribe' && expected && token && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return safeJson(403, 'forbidden', requestId);
}

/** POST — ingest a (mock) webhook delivery. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  if (!publicWebhooksEnabled()) return safeJson(404, 'not_found', requestId);
  const admin = createSupabaseAdminClient();

  const endpoint = await resolveEndpointByConnection(admin, connectionId);
  if (!endpoint) return safeJson(404, 'not_found', requestId);

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY) return safeJson(413, 'payload_too_large', requestId);

  // If a signature is required but no secret-ref is configured, reject early —
  // never accept an unverifiable signed webhook.
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
  // Record-only: always return a generic ack to authenticated/accepted requests.
  return Response.json({ ok: true, requestId }, { status: 202 });
}
