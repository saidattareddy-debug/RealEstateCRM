import type { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ingestLead } from '@/lib/leads/ingest';
import { ADAPTERS } from '@/lib/leads/adapters';
import { verifyApiKey, verifyHmac, timestampWithinTolerance, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';

/**
 * POST /webhooks/leads/[source] — provider webhook ingestion (MASTER_SPEC §8).
 * [source] selects a SYNTHETIC dev adapter (generic | nobroker | 99acres |
 * housing | meta | google). Auth: `x-form-id` + (`x-api-key` hashed compare, or
 * `x-signature` HMAC when the form carries a shared secret in dev). Idempotency
 * is keyed on the provider external id. Not connected to live providers.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const adapter = ADAPTERS[source];
  if (!adapter) return safeJson(404, 'unknown_source', requestId);

  const formId = req.headers.get('x-form-id');
  if (!formId) return safeJson(401, 'unauthorized', requestId);
  const ts = req.headers.get('x-timestamp');
  if (ts && !timestampWithinTolerance(ts)) return safeJson(401, 'stale_request', requestId);

  const admin = createSupabaseAdminClient();
  const { data: form } = await admin
    .from('public_lead_forms')
    .select('id, tenant_id, status, secret_hash, rate_limit_per_min')
    .eq('id', formId)
    .maybeSingle();
  if (!form || form.status !== 'active') return safeJson(401, 'unauthorized', requestId);

  const raw = await req.text();
  if (raw.length > 65_536) return safeJson(413, 'payload_too_large', requestId);

  // Auth: api-key hash OR HMAC signature (dev shared secret is the api key).
  const apiKey = req.headers.get('x-api-key');
  const signature = req.headers.get('x-signature');
  const secretHash = form.secret_hash as string | null;
  const authed =
    (apiKey && verifyApiKey(secretHash, apiKey)) ||
    (signature && apiKey && verifyHmac(apiKey, raw, signature));
  if (!authed) return safeJson(401, 'unauthorized', requestId);

  if (!rateLimit(`wh:${form.id}`, (form.rate_limit_per_min as number) ?? 60)) {
    return safeJson(429, 'rate_limited', requestId);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }

  const { input, externalEventId, sourceKind } = adapter(body);
  try {
    const res = await ingestLead(form.tenant_id as string, input, {
      sourceKind,
      externalEventId,
      correlationId: requestId,
    });
    return Response.json(
      {
        ok: true,
        version: 'v1',
        requestId,
        data: { leadId: res.leadId, idempotent: !!res.idempotentHit },
      },
      { status: 200 },
    );
  } catch {
    return safeJson(500, 'ingestion_failed', requestId);
  }
}
