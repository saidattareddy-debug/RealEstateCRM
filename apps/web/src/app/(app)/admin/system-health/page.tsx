import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { loadSystemHealth } from '@/lib/analytics/queries';
import type { SystemHealthState } from '@re/domain';

export const dynamic = 'force-dynamic';

const STATE_STYLE: Record<SystemHealthState, string> = {
  healthy: 'bg-success/10 text-success',
  degraded: 'bg-warning/10 text-warning',
  down: 'bg-terracotta/10 text-terracotta',
  unknown: 'bg-surface-elevated text-text-secondary',
};

function StateBadge({ state }: { state: SystemHealthState }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${STATE_STYLE[state]}`}
    >
      {state}
    </span>
  );
}

export default async function SystemHealthPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'system.health.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { rows, overall } = await loadSystemHealth(supabase);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-text-primary">System health</h1>
          <p className="text-sm text-text-secondary">
            Latest recorded health per component. The overall state is the worst component state —
            never optimistic. External providers report &ldquo;unknown&rdquo; until a probe records
            a check; this page performs no outbound network calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Overall</span>
          <StateBadge state={overall} />
        </div>
      </header>

      <Panel title="Components">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Component</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 text-right font-medium">Latency</th>
                <th className="pb-2 font-medium">Detail</th>
                <th className="pb-2 font-medium">Checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.component} className="border-b border-border/60 last:border-0">
                  <td className="py-2 capitalize text-text-primary">{r.component}</td>
                  <td className="py-2">
                    <StateBadge state={r.state} />
                  </td>
                  <td className="py-2 text-right text-text-secondary">
                    {r.latencyMs == null ? '—' : `${r.latencyMs}ms`}
                  </td>
                  <td className="py-2 text-text-secondary">{r.detail ?? '—'}</td>
                  <td className="py-2 text-text-secondary">
                    {r.checkedAt ? new Date(r.checkedAt).toLocaleString() : 'live'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
