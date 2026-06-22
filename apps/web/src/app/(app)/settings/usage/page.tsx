import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import {
  loadUsage,
  loadBillingPeriods,
  usageMetricLabel,
  type UsageReport,
} from '@/lib/analytics/queries';
import { BillingPeriodForm } from './billing-form';

export const dynamic = 'force-dynamic';

export default async function UsageBillingPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'billing.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const [usage, periods] = await Promise.all([
    loadUsage(supabase, ctx.activeTenantId!),
    loadBillingPeriods(supabase),
  ]);

  const canManage = ensurePermission(ctx, 'billing.manage');
  const currentPeriod = periods.find(
    (p) => p.periodStart === usage.periodStart && p.periodEnd === usage.periodEnd,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Usage &amp; billing</h1>
        <p className="text-sm text-text-secondary">
          Live usage against your plan limits for the current period, plus recorded billing periods.
          Figures are computed from your real, permission-scoped data.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Plan" value={titleCase(usage.planTier)} />
        <StatCard
          label="Period"
          value={usage.periodStart ?? '—'}
          hint={usage.periodEnd ? `through ${usage.periodEnd}` : undefined}
        />
        <StatCard label="Limit status" value={usage.overLimit ? 'Over limit' : 'Within limits'} />
      </div>

      <Panel title="Usage vs. plan limits">
        <UsageBars usage={usage} />
      </Panel>

      <Panel title="Billing periods">
        {periods.length === 0 ? (
          <EmptyState
            title="No billing periods recorded"
            hint={canManage ? 'Use the form below to record the current period.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Period</th>
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Amount due</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">
                      {p.periodStart} → {p.periodEnd}
                    </td>
                    <td className="py-2 text-text-secondary">{titleCase(p.planTier)}</td>
                    <td className="py-2 text-text-secondary">{titleCase(p.status)}</td>
                    <td className="py-2 text-right text-text-primary">
                      {p.currency} {p.amountDue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canManage && (
        <Panel title="Update current billing period">
          <BillingPeriodForm
            defaults={{
              periodStart: currentPeriod?.periodStart ?? usage.periodStart ?? '',
              periodEnd: currentPeriod?.periodEnd ?? usage.periodEnd ?? '',
              planTier: currentPeriod?.planTier ?? usage.planTier,
              status: currentPeriod?.status ?? 'open',
              currency: currentPeriod?.currency ?? 'INR',
              amountDue: currentPeriod?.amountDue ?? 0,
            }}
          />
        </Panel>
      )}
    </div>
  );
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function UsageBars({ usage }: { usage: UsageReport }) {
  return (
    <div className="space-y-4">
      {usage.metrics.map((m) => {
        const unlimited = m.limit == null;
        const width = Math.max(0, Math.min(100, m.utilization));
        const barColor = m.overLimit ? 'bg-terracotta' : m.nearLimit ? 'bg-warning' : 'bg-forest';
        return (
          <div key={m.metric} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-primary">{usageMetricLabel(m.metric)}</span>
              <span className="text-text-secondary tabular-nums">
                {m.used.toLocaleString()} / {unlimited ? '∞' : m.limit!.toLocaleString()}
                {m.overLimit && (
                  <span className="ml-2 rounded bg-terracotta/10 px-1.5 py-0.5 text-xs font-medium text-terracotta">
                    over limit
                  </span>
                )}
                {!m.overLimit && m.nearLimit && (
                  <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                    near limit
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: unlimited ? '0%' : `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
