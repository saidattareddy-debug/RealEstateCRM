import type { NextRequest } from 'next/server';
import { leadInputSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ingestLead } from '@/lib/leads/ingest';
import { originAllowed, timestampWithinTolerance, safeJson } from '@/lib/leads/security';
import { rateLimit } from '@/lib/leads/rate-limit';

/**
 * POST /api/forms/[formId] — hardened public website lead form (Phase 3.1 §5).
 * Protected by: origin allow-list, request-size limit, rate limiting, timestamp
 * replay protection, honeypot, consent capture. Never reveals whether a phone
 * or email already exists; never exposes tenant IDs or DB errors. Every attempt
 * is logged to public_lead_form_submissions.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const origin = req.headers.get('origin');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const admin = createSupabaseAdminClient();

  const log = async (status: 'accepted' | 'rejected', reason?: string, tenantId?: string) => {
    if (!tenantId) return;
    await admin.from('public_lead_form_submissions').insert({
      tenant_id: tenantId,
      form_id: formId,
      status,
      reason: reason ?? null,
      correlation_id: requestId,
      ip_address: ip,
    });
  };

  const { data: form } = await admin
    .from('public_lead_forms')
    .select(
      'id, tenant_id, source_id, project_id, campaign, status, allowed_origins, rate_limit_per_min, consent_required, honeypot_field',
    )
    .eq('id', formId)
    .maybeSingle();
  if (!form || form.status !== 'active') return safeJson(404, 'not_found', requestId);
  const tenantId = form.tenant_id as string;

  if (!originAllowed((form.allowed_origins as string[]) ?? [], origin)) {
    await log('rejected', 'origin', tenantId);
    return safeJson(403, 'forbidden', requestId);
  }
  const ts = req.headers.get('x-timestamp');
  if (ts && !timestampWithinTolerance(ts)) {
    await log('rejected', 'stale', tenantId);
    return safeJson(401, 'stale_request', requestId);
  }
  if (!rateLimit(`form:${formId}:${ip ?? 'anon'}`, (form.rate_limit_per_min as number) ?? 30)) {
    await log('rejected', 'rate_limit', tenantId);
    return safeJson(429, 'rate_limited', requestId);
  }

  const raw = await req.text();
  if (raw.length > 16_384) {
    await log('rejected', 'too_large', tenantId);
    return safeJson(413, 'payload_too_large', requestId);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return safeJson(400, 'invalid_json', requestId);
  }

  // Honeypot: a filled hidden field => bot. Accept silently (don't reveal).
  const honey = form.honeypot_field as string;
  if (honey && typeof body[honey] === 'string' && (body[honey] as string).trim() !== '') {
    await log('rejected', 'honeypot', tenantId);
    return Response.json({ ok: true, requestId }, { status: 202 });
  }
  if (form.consent_required && body.consent !== true) {
    await log('rejected', 'consent', tenantId);
    return safeJson(422, 'consent_required', requestId);
  }

  const parsed = leadInputSchema.safeParse({ ...body, campaign: body.campaign ?? form.campaign });
  if (!parsed.success) {
    await log('rejected', 'validation', tenantId);
    return safeJson(422, 'invalid_payload', requestId);
  }

  try {
    await ingestLead(tenantId, parsed.data, { sourceKind: 'form', correlationId: requestId });
    await log('accepted', undefined, tenantId);
    // Non-disclosing success — never reveal whether the contact already existed.
    return Response.json({ ok: true, requestId }, { status: 202 });
  } catch {
    return safeJson(500, 'submission_failed', requestId);
  }
}
