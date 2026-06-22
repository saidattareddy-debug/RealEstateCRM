import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { loadTeamPerformance } from '@/lib/analytics/queries';

export const dynamic = 'force-dynamic';

export default async function TeamPerformancePage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'analytics.agents.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const team = await loadTeamPerformance(supabase);

  const canExport = ensurePermission(ctx, 'analytics.export');
  const totalAssigned = team.reduce((a, t) => a + t.assigned, 0);
  const totalWon = team.reduce((a, t) => a + t.won, 0);
  const respSamples = team.filter((t) => t.avgFirstResponseMins != null);
  const avgResp =
    respSamples.length > 0
      ? respSamples.reduce((a, t) => a + (t.avgFirstResponseMins ?? 0), 0) / respSamples.length
      : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-text-primary">Team performance</h1>
          <p className="text-sm text-text-secondary">
            Per-agent assignment, win rate, and first-response time — from your permission-scoped
            lead and conversation data.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link
            href="/analytics"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
          >
            Sales analytics
          </Link>
          {canExport && (
            <a
              href="/analytics/export?report=team"
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
            >
              Export CSV
            </a>
          )}
        </nav>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Assigned leads" value={totalAssigned} />
        <StatCard label="Won" value={totalWon} />
        <StatCard
          label="Avg first response"
          value={avgResp == null ? '—' : `${avgResp.toFixed(1)}m`}
        />
      </div>

      <Panel title="Agents">
        {team.length === 0 ? (
          <EmptyState
            title="No assigned agents yet"
            hint="Per-agent metrics appear once leads are assigned to team members."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 text-right font-medium">Assigned</th>
                  <th className="pb-2 text-right font-medium">Open</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Lost</th>
                  <th className="pb-2 text-right font-medium">Win rate</th>
                  <th className="pb-2 text-right font-medium">Avg response</th>
                </tr>
              </thead>
              <tbody>
                {team.map((t) => (
                  <tr key={t.agentId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">{t.name}</td>
                    <td className="py-2 text-right text-text-primary">{t.assigned}</td>
                    <td className="py-2 text-right text-text-secondary">{t.openLeads}</td>
                    <td className="py-2 text-right text-success">{t.won}</td>
                    <td className="py-2 text-right text-text-secondary">{t.lost}</td>
                    <td className="py-2 text-right text-text-secondary">{t.winRate.toFixed(1)}%</td>
                    <td className="py-2 text-right text-text-secondary">
                      {t.avgFirstResponseMins == null ? '—' : `${t.avgFirstResponseMins}m`}
                    </td>
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
