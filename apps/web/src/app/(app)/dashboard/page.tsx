import Link from 'next/link';
import { deploymentProfile } from '@re/config';
import { getAppContext } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/states';
import {
  resolveDashboardVariant,
  visibleKpis,
  VARIANT_PANELS,
  quickActions,
  greeting,
  firstName,
  environmentBadge,
  type PanelKey,
} from '@/lib/dashboard/config';
import { loadDashboard } from '@/lib/dashboard/queries';
import {
  KpiGrid,
  EnvBadge,
  LeadsAttentionPanel,
  TasksPanel,
  ConversationsPanel,
  PipelinePanel,
  InventoryAlertsPanel,
  ActivityPanel,
  SourcesPanel,
} from '@/components/dashboard/widgets';

/** Which permission a panel needs (aggregate panels allow marketing metadata). */
function panelAllowed(key: PanelKey, perms: Set<string>): boolean {
  switch (key) {
    case 'leadsAttention':
      return perms.has('leads.read.assigned');
    case 'tasksDue':
      return perms.has('tasks.manage');
    case 'recentConversations':
      return perms.has('conversations.read.assigned');
    case 'pipelineOverview':
      return perms.has('leads.read.assigned') || perms.has('conversations.read.metadata');
    case 'inventoryAlerts':
      return perms.has('inventory.read');
    case 'recentActivity':
      return perms.has('settings.audit.read');
    case 'leadSources':
      return perms.has('conversations.read.metadata') || perms.has('leads.read.assigned');
    default:
      return false;
  }
}

export default async function DashboardPage() {
  const ctx = await getAppContext();

  if (!ctx.activeTenantId) {
    return (
      <EmptyState
        title="No active workspace"
        hint="You are not yet a member of any tenant. Ask an administrator for an invitation."
      />
    );
  }

  const active = ctx.memberships.find((m) => m.tenantId === ctx.activeTenantId);
  const perms = ctx.permissions;
  const variant = resolveDashboardVariant(active?.roleSlug ?? '', perms);

  const kpiKeys = visibleKpis(variant, perms);
  const panelKeys = VARIANT_PANELS[variant].filter((k) => panelAllowed(k, perms));
  const actions = quickActions(perms);

  const supabase = await createSupabaseServerClient();
  const { metrics, panels } = await loadDashboard(supabase, {
    tenantId: ctx.activeTenantId,
    metricKeys: kpiKeys,
    panelKeys,
  });

  const badge = environmentBadge(deploymentProfile(), process.env.APP_ENV);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary">
              {greeting()}, {firstName(ctx.fullName, ctx.email)}
            </h1>
            {badge ? <EnvBadge text={badge} /> : null}
          </div>
          <p className="text-sm text-text-secondary">
            {active?.tenantName} · {today}
          </p>
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) => (
              <Link
                key={a.href}
                href={a.href}
                className={
                  i === 0
                    ? 'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest'
                    : 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                }
              >
                {a.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      {/* KPI cards */}
      <KpiGrid keys={kpiKeys} metrics={metrics} />

      {/* Panels — single column on mobile, two columns from lg up */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {panelKeys.includes('leadsAttention') && panels.leadsAttention ? (
          <LeadsAttentionPanel leads={panels.leadsAttention} />
        ) : null}
        {panelKeys.includes('tasksDue') && panels.tasksDue ? (
          <TasksPanel tasks={panels.tasksDue} />
        ) : null}
        {panelKeys.includes('recentConversations') && panels.recentConversations ? (
          <ConversationsPanel rows={panels.recentConversations} />
        ) : null}
        {panelKeys.includes('pipelineOverview') && panels.pipelineOverview ? (
          <PipelinePanel stages={panels.pipelineOverview} />
        ) : null}
        {panelKeys.includes('inventoryAlerts') && panels.inventoryAlerts ? (
          <InventoryAlertsPanel data={panels.inventoryAlerts} />
        ) : null}
        {panelKeys.includes('leadSources') && panels.leadSources ? (
          <SourcesPanel sources={panels.leadSources} />
        ) : null}
        {panelKeys.includes('recentActivity') && panels.recentActivity ? (
          <ActivityPanel rows={panels.recentActivity} />
        ) : null}
      </div>
    </div>
  );
}
