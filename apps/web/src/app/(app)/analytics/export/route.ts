import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadFunnel, loadSourcePerformance, loadTeamPerformance } from '@/lib/analytics/queries';
import { recordExport, toCsv } from '@/lib/analytics/export-service';

/**
 * CSV export of an analytics report over the caller's RLS-visible data. Every
 * export is an auditable egress: it writes an `analytics_export_logs` row and an
 * `ANALYTICS_EXPORTED` audit entry via `recordExport`, and the CSV is
 * formula-injection-safe.
 */
export async function GET(request: Request) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'analytics.export')) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!ctx.activeTenantId) return new Response('No active tenant', { status: 400 });

  const url = new URL(request.url);
  const report = url.searchParams.get('report') ?? 'overview';
  const supabase = await createSupabaseServerClient();

  let filename = 'analytics';
  let header: string[] = [];
  let rows: unknown[][] = [];

  if (report === 'team') {
    // Team report requires the agent-analytics permission.
    if (!ensurePermission(ctx, 'analytics.agents.read')) {
      return new Response('Forbidden', { status: 403 });
    }
    filename = 'team-performance';
    const team = await loadTeamPerformance(supabase);
    header = [
      'agent',
      'assigned',
      'won',
      'lost',
      'open',
      'win_rate_pct',
      'avg_first_response_mins',
    ];
    rows = team.map((t) => [
      t.name,
      t.assigned,
      t.won,
      t.lost,
      t.openLeads,
      t.winRate,
      t.avgFirstResponseMins ?? '',
    ]);
  } else {
    // Default: pipeline funnel + source performance in one workbook-style CSV is
    // overkill; emit the source-performance table (the marketing/sales staple).
    filename = 'sales-overview';
    const [funnel, sources] = await Promise.all([
      loadFunnel(supabase),
      loadSourcePerformance(supabase),
    ]);
    header = ['section', 'name', 'leads_or_reached', 'won', 'lost', 'win_rate_or_conversion_pct'];
    for (const f of funnel)
      rows.push(['funnel_stage', f.name, f.reached, '', f.droppedFromPrev, f.conversionFromTop]);
    for (const s of sources) rows.push(['source', s.name, s.leads, s.won, s.lost, s.winRate]);
  }

  const body = toCsv(header, rows);

  await recordExport(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    report: report === 'team' ? 'team_performance' : 'sales_overview',
    format: 'csv',
    rowCount: rows.length,
    filters: { report },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
}
