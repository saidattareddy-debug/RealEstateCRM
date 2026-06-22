import type { NextRequest } from 'next/server';
import { leadInputSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ingestLead } from '@/lib/leads/ingest';
import { verifyApiKey, timestampWithinTolerance, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';

/**
 * POST /api/v1/leads — generic authenticated lead ingestion (MASTER_SPEC §30).
 * Auth: `x-form-id` + `x-api-key` (key is sha256-compared to the stored hash).
 * Headers: `idempotency-key` (optional), `x-timestamp` (optional, tolerance
 * checked), `x-request-id`. Versioned response, idempotent, safe errors.
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const formId = req.headers.get('x-form-id');
  const apiKey = req.headers.get('x-api-key');
  if (!formId || !apiKey) return safeJson(401, 'unauthorized', requestId);

  const ts = req.headers.get('x-timestamp');
  if (ts && !timestampWithinTolerance(ts)) return safeJson(401, 'stale_request', requestId);

  const admin = createSupabaseAdminClient();
  const { data: form } = await admin
    .from('public_lead_forms')
    .select(
      'id, tenant_id, source_id, project_id, campaign, status, secret_hash, rate_limit_per_min',
    )
    .eq('id', formId)
    .maybeSingle();
  // Non-disclosing: same response whether the form is missing or the key is wrong.
  if (
    !form ||
    form.status !== 'active' ||
    !verifyApiKey(form.secret_hash as string | null, apiKey)
  ) {
    return safeJson(401, 'unauthorized', requestId);
  }

  if (!rateLimit(`api:${form.id}`, (form.rate_limit_per_min as number) ?? 30)) {
    return safeJson(429, 'rate_limited', requestId);
  }

  const raw = await req.text();
  if (raw.length > 32_768) return safeJson(413, 'payload_too_large', requestId);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }
  const parsed = leadInputSchema.safeParse(body);
  if (!parsed.success) return safeJson(422, 'invalid_payload', requestId);

  try {
    const res = await ingestLead(form.tenant_id as string, parsed.data, {
      sourceKind: 'api',
      idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
      correlationId: requestId,
    });
    return Response.json(
      {
        ok: true,
        version: 'v1',
        requestId,
        data: { leadId: res.leadId, idempotent: !!res.idempotentHit, status: res.status },
      },
      { status: res.idempotentHit ? 200 : 201 },
    );
  } catch {
    return safeJson(500, 'ingestion_failed', requestId);
  }
}
