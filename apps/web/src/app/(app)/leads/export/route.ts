import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** CSV export of the caller's RLS-visible leads (leads.export). */
export async function GET() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'leads.export')) {
    return new Response('Forbidden', { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: leads } = await supabase
    .from('leads')
    .select(
      'full_name, primary_phone_national, primary_email, operational_status, category, score, campaign',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5000);

  const header = ['name', 'phone', 'email', 'status', 'category', 'score', 'campaign'];
  // Escape CSV special chars AND neutralise spreadsheet formula injection by
  // prefixing values that start with = + - @ (or tab/CR) with an apostrophe.
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const l of leads ?? []) {
    lines.push(
      [
        l.full_name,
        l.primary_phone_national,
        l.primary_email,
        l.operational_status,
        l.category,
        l.score,
        l.campaign,
      ]
        .map(esc)
        .join(','),
    );
  }

  // Export is an auditable data egress (MASTER_SPEC §28).
  const { writeAudit } = await import('@/lib/audit/audit-service');
  await writeAudit({
    action: 'EXPORT_REQUEST',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'leads_export',
    newValues: { count: leads?.length ?? 0 },
  });

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"',
    },
  });
}
