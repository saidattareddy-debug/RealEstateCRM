/**
 * Pure dashboard configuration — greeting, identity, role→variant resolution,
 * environment badge, KPI/quick-action/panel selection. No `server-only`, no IO:
 * safe to unit-test. Row visibility is enforced by RLS in `queries.ts`; this
 * module only decides WHICH cards/panels a role may see (permission-gated).
 */
import type { PermissionKey } from '@re/validation';

export type DashboardVariant = 'admin' | 'manager' | 'agent' | 'marketing' | 'project' | 'viewer';

export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(fullName: string | null | undefined, email: string): string {
  const name = (fullName ?? '').trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  const local = email.split('@')[0] ?? email;
  return local || 'there';
}

/** Subtle environment badge text (null = production/no badge). */
export function environmentBadge(
  profile: string | undefined,
  appEnv: string | undefined,
): string | null {
  const controlled = profile === 'controlled_mvp';
  if (appEnv === 'staging') return controlled ? 'Staging · Controlled MVP' : 'Staging';
  if (appEnv === 'production') return controlled ? 'Controlled MVP' : null;
  // local / dev
  return controlled ? 'Controlled MVP' : null;
}

const ROLE_VARIANT: Record<string, DashboardVariant> = {
  client_admin: 'admin',
  platform_admin: 'admin',
  sales_manager: 'manager',
  sales_agent: 'agent',
  marketing_manager: 'marketing',
  project_maintenance: 'project',
  project_data: 'project',
  viewer: 'viewer',
};

/** Resolve the dashboard variant from role slug, falling back to permissions. */
export function resolveDashboardVariant(
  roleSlug: string,
  permissions: Iterable<string>,
): DashboardVariant {
  const byRole = ROLE_VARIANT[roleSlug];
  if (byRole) return byRole;
  const p = permissions instanceof Set ? permissions : new Set(permissions);
  if (p.has('settings.org.manage')) return 'admin';
  if (p.has('leads.read.all') || p.has('leads.read.team')) return 'manager';
  if (p.has('leads.read.assigned')) return 'agent';
  if (p.has('inventory.manage') || p.has('projects.manage')) return 'project';
  if (p.has('conversations.read.metadata')) return 'marketing';
  return 'viewer';
}

export type MetricKey =
  | 'newLeadsToday'
  | 'newLeadsWeek'
  | 'unassignedLeads'
  | 'openConversations'
  | 'waitingConversations'
  | 'overdueTasks'
  | 'upcomingTasks'
  | 'hotLeads'
  | 'warmLeads'
  | 'availableInventory'
  | 'staleInventory'
  | 'teamMembers'
  | 'leadVolume'
  | 'leadSources'
  | 'activeProjects'
  | 'unitsNeedingVerification';

export interface KpiDef {
  label: string;
  context: string;
  href: string;
  /** Permission required to show this card (RLS still governs the number). */
  requires?: PermissionKey;
}

export const KPI_DEFS: Record<MetricKey, KpiDef> = {
  newLeadsToday: {
    label: 'New leads today',
    context: 'Created since midnight',
    href: '/leads?range=today',
    requires: 'leads.read.assigned',
  },
  newLeadsWeek: {
    label: 'New leads this week',
    context: 'Last 7 days',
    href: '/leads?range=week',
    requires: 'leads.read.assigned',
  },
  unassignedLeads: {
    label: 'Unassigned leads',
    context: 'Awaiting an owner',
    href: '/leads?filter=unassigned',
    requires: 'leads.read.team',
  },
  openConversations: {
    label: 'Open conversations',
    context: 'Not yet closed',
    href: '/inbox?status=open',
    requires: 'conversations.read.assigned',
  },
  waitingConversations: {
    label: 'Waiting for an agent',
    context: 'Customer awaiting a reply',
    href: '/inbox?filter=waiting',
    requires: 'conversations.read.assigned',
  },
  overdueTasks: {
    label: 'Overdue tasks',
    context: 'Past their due time',
    href: '/tasks?filter=overdue',
    requires: 'tasks.manage',
  },
  upcomingTasks: {
    label: 'Upcoming tasks',
    context: 'Due soon',
    href: '/tasks?filter=upcoming',
    requires: 'tasks.manage',
  },
  hotLeads: {
    label: 'Hot leads',
    context: 'Advisory classification',
    href: '/leads?category=hot',
    requires: 'leads.read.assigned',
  },
  warmLeads: {
    label: 'Warm leads',
    context: 'Advisory classification',
    href: '/leads?category=warm',
    requires: 'leads.read.assigned',
  },
  availableInventory: {
    label: 'Available units',
    context: 'Verified & offerable',
    href: '/inventory?status=available',
    requires: 'inventory.read',
  },
  staleInventory: {
    label: 'Stale inventory',
    context: 'Needs re-verification',
    href: '/inventory?filter=stale',
    requires: 'inventory.read',
  },
  teamMembers: {
    label: 'Team members',
    context: 'Active in this workspace',
    href: '/team',
    requires: 'team.performance.read',
  },
  leadVolume: {
    label: 'Lead volume',
    context: 'Last 30 days',
    href: '/leads?range=month',
    requires: 'conversations.read.metadata',
  },
  leadSources: {
    label: 'Active sources',
    context: 'Distinct lead sources',
    href: '/leads',
    requires: 'conversations.read.metadata',
  },
  activeProjects: {
    label: 'Active projects',
    context: 'Currently live',
    href: '/projects',
    requires: 'projects.read',
  },
  unitsNeedingVerification: {
    label: 'Units to verify',
    context: 'Freshness window elapsed',
    href: '/inventory?filter=stale',
    requires: 'inventory.read',
  },
};

export type PanelKey =
  | 'leadsAttention'
  | 'tasksDue'
  | 'recentConversations'
  | 'pipelineOverview'
  | 'inventoryAlerts'
  | 'recentActivity'
  | 'leadSources';

export const VARIANT_KPIS: Record<DashboardVariant, MetricKey[]> = {
  admin: [
    'newLeadsToday',
    'unassignedLeads',
    'openConversations',
    'waitingConversations',
    'overdueTasks',
    'availableInventory',
  ],
  manager: [
    'newLeadsToday',
    'unassignedLeads',
    'waitingConversations',
    'overdueTasks',
    'hotLeads',
    'openConversations',
  ],
  agent: [
    'newLeadsToday',
    'openConversations',
    'waitingConversations',
    'overdueTasks',
    'upcomingTasks',
    'hotLeads',
  ],
  marketing: ['leadVolume', 'newLeadsToday', 'newLeadsWeek', 'leadSources'],
  project: ['availableInventory', 'staleInventory', 'unitsNeedingVerification', 'activeProjects'],
  viewer: ['newLeadsWeek', 'openConversations', 'availableInventory'],
};

export const VARIANT_PANELS: Record<DashboardVariant, PanelKey[]> = {
  admin: [
    'leadsAttention',
    'tasksDue',
    'recentConversations',
    'pipelineOverview',
    'inventoryAlerts',
    'recentActivity',
  ],
  manager: [
    'leadsAttention',
    'tasksDue',
    'recentConversations',
    'pipelineOverview',
    'recentActivity',
  ],
  agent: ['leadsAttention', 'tasksDue', 'recentConversations', 'recentActivity'],
  // Marketing: aggregate/metadata only — never lead-attention, conversations or tasks.
  marketing: ['pipelineOverview', 'leadSources', 'recentActivity'],
  project: ['inventoryAlerts', 'recentActivity'],
  viewer: ['pipelineOverview', 'recentActivity'],
};

export interface QuickAction {
  label: string;
  href: string;
  requires: PermissionKey;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Add lead', href: '/leads?new=1', requires: 'leads.create' },
  { label: 'Create task', href: '/tasks?new=1', requires: 'tasks.manage' },
  { label: 'Add project', href: '/projects?new=1', requires: 'projects.manage' },
  { label: 'Import inventory', href: '/inventory/import', requires: 'inventory.import' },
  { label: 'Open inbox', href: '/inbox', requires: 'conversations.read.assigned' },
];

export function quickActions(permissions: Iterable<string>): QuickAction[] {
  const p = permissions instanceof Set ? permissions : new Set(permissions);
  return QUICK_ACTIONS.filter((a) => p.has(a.requires));
}

/** KPI keys for a variant, dropping any the user lacks permission to see. */
export function visibleKpis(variant: DashboardVariant, permissions: Iterable<string>): MetricKey[] {
  const p = permissions instanceof Set ? permissions : new Set(permissions);
  return VARIANT_KPIS[variant].filter((k) => {
    const req = KPI_DEFS[k].requires;
    return !req || p.has(req);
  });
}
