import { NextResponse, type NextRequest } from 'next/server';
import { leadInputSchema } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ingestLead } from '@/lib/leads/ingest';

/**
 * Public website lead-form / webhook ingestion endpoint (MASTER_SPEC §8, §20).
 * POST /forms/:tenant — :tenant is the tenant slug or id. No auth; the tenant
 * is resolved server-side and ingestion runs with the service-role client.
 * (Signature verification + rate limiting are added per-integration in Phase 7.)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = leadInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid lead payload' }, { status: 422 });
  }

  const admin = createSupabaseAdminClient();
  const isUuid = /^[0-9a-f-]{36}$/i.test(tenant);
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, status')
    .eq(isUuid ? 'id' : 'slug', tenant)
    .maybeSingle();
  if (!tenantRow || tenantRow.status !== 'active') {
    return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 });
  }

  try {
    const res = await ingestLead(tenantRow.id as string, parsed.data, { sourceKind: 'form' });
    return NextResponse.json({ ok: true, leadId: res.leadId, duplicates: res.duplicates });
  } catch {
    return NextResponse.json({ error: 'Ingestion failed' }, { status: 500 });
  }
}
