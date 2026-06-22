import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { loadFunnel, loadSourcePerformance } from '@/lib/analytics/queries';

export const dynamic = 'force-dynamic';

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default async function AnalyticsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'analytics.sales.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const [funnel, sources] = await Promise.all([
    loadFunnel(supabase),
    loadSourcePerformance(supabase),
  ]);

  const canExport = ensurePermission(ctx, 'analytics.export');
  const canMarketing = ensurePermission(ctx, 'analytics.marketing.read');

  const topReach = funnel[0]?.reached ?? 0;
  const bottomReach = funnel.length > 0 ? funnel[funnel.length - 1]!.reached : 0;
  const overallConversion = funnel.length > 0 ? funnel[funnel.length - 1]!.conversionFromTop : 0;
  const totalLeads = sources.reduce((a, s) => a + s.leads, 0);
  const totalWon = sources.reduce((a, s) => a + s.won, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-text-primary">Sales analytics</h1>
          <p className="text-sm text-text-secondary">
            Pipeline conversion and lead-source performance, computed live from your
            permission-scoped data.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {ensurePermission(ctx, 'analytics.agents.read') && (
            <Link
              href="/analytics/team"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
            >
              Team performance
            </Link>
          )}
          {canExport && (
            <a
              href="/analytics/export?report=overview"
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
            >
              Export CSV
            </a>
          )}
        </nav>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Top-of-funnel leads" value={topReach} />
        <StatCard label="Reached final stage" value={bottomReach} />
        <StatCard label="Overall conversion" value={fmtPct(overallConversion)} />
        <StatCard
          label="Won (by source)"
          value={totalWon}
          hint={`${totalLeads} leads attributed`}
        />
      </div>

      <Panel title="Pipeline funnel">
        {funnel.length === 0 ? (
          <EmptyState
            title="No pipeline data yet"
            hint="Funnel metrics appear once leads move through your pipeline stages."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 text-right font-medium">Reached</th>
                  <th className="pb-2 text-right font-medium">From top</th>
                  <th className="pb-2 text-right font-medium">From previous</th>
                  <th className="pb-2 text-right font-medium">Dropped</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((s) => (
                  <tr key={s.stageId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">{s.name}</td>
                    <td className="py-2 text-right text-text-primary">{s.reached}</td>
                    <td className="py-2 text-right text-text-secondary">
                      <ConversionBar pct={s.conversionFromTop} />
                    </td>
                    <td className="py-2 text-right text-text-secondary">
                      {fmtPct(s.conversionFromPrev)}
                    </td>
                    <td className="py-2 text-right text-text-secondary">{s.droppedFromPrev}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Lead-source performance">
        {sources.length === 0 ? (
          <EmptyState
            title="No source data yet"
            hint="Configure lead sources and attribute leads to see performance here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Lost</th>
                  <th className="pb-2 text-right font-medium">Win rate</th>
                  {canMarketing && <th className="pb-2 text-right font-medium">Cost / lead</th>}
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.sourceId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">{s.name}</td>
                    <td className="py-2 text-right text-text-primary">{s.leads}</td>
                    <td className="py-2 text-right text-success">{s.won}</td>
                    <td className="py-2 text-right text-text-secondary">{s.lost}</td>
                    <td className="py-2 text-right text-text-secondary">{fmtPct(s.winRate)}</td>
                    {canMarketing && (
                      <td className="py-2 text-right text-text-secondary">
                        {s.costPerLead == null ? '—' : s.costPerLead.toFixed(2)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ConversionBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-surface-elevated sm:block">
        <div className="h-full rounded-full bg-forest" style={{ width: `${width}%` }} />
      </div>
      <span className="tabular-nums">{fmtPct(pct)}</span>
    </div>
  );
}
