import type { PermissionKey } from '@re/validation';
import type { FeatureFlag } from '@re/config';

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name (resolved in the sidebar). */
  icon: string;
  /** Shown only when the user holds this permission. */
  requires?: PermissionKey;
  /** Shown only when this tenant feature flag is enabled. */
  flag?: FeatureFlag;
}

export interface NavGroup {
  /** Stable id (used for the collapse-state key). */
  id: string;
  /** Section heading; null for the unlabelled primary group. */
  label: string | null;
  /** Whether the group renders as a collapsible section. */
  collapsible: boolean;
  items: NavItem[];
}

/**
 * Primary product navigation — the day-to-day CRM surfaces, in workflow order.
 * Only permitted pages render, so there are never dead or teasing links
 * (docs/CONTRADICTIONS.md C13). Test/diagnostic pages live under Developer tools.
 */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
  { label: 'Inbox', href: '/inbox', icon: 'inbox', requires: 'conversations.read.assigned' },
  { label: 'Leads', href: '/leads', icon: 'leads', requires: 'leads.read.assigned' },
  { label: 'Pipeline', href: '/pipeline', icon: 'pipeline', requires: 'leads.read.assigned' },
  { label: 'Tasks', href: '/tasks', icon: 'tasks', requires: 'tasks.manage' },
  { label: 'Projects', href: '/projects', icon: 'projects', requires: 'projects.read' },
  { label: 'Inventory', href: '/inventory', icon: 'inventory', requires: 'inventory.read' },
  { label: 'Knowledge', href: '/knowledge', icon: 'knowledge', requires: 'knowledge.read' },
];

/** Administration — tenant configuration and oversight surfaces. */
export const ADMIN_NAV: NavItem[] = [
  { label: 'Analytics', href: '/analytics', icon: 'analytics', requires: 'analytics.sales.read' },
  {
    label: 'Usage & billing',
    href: '/settings/usage',
    icon: 'billing',
    requires: 'billing.read',
  },
  {
    label: 'System health',
    href: '/admin/system-health',
    icon: 'health',
    requires: 'system.health.read',
  },
  { label: 'Automations', href: '/automations', icon: 'automations', requires: 'automations.read' },
  { label: 'Visits', href: '/visits', icon: 'visits', requires: 'sitevisits.read' },
  { label: 'Team', href: '/team', icon: 'team', requires: 'team.performance.read' },
  { label: 'Scoring', href: '/settings/scoring', icon: 'scoring', requires: 'scoring.models.read' },
  {
    label: 'Matching',
    href: '/settings/matching',
    icon: 'matching',
    requires: 'matching.models.read',
  },
  {
    label: 'Integrations',
    href: '/settings/integrations',
    icon: 'integrations',
    requires: 'settings.org.manage',
  },
  { label: 'Audit Log', href: '/audit', icon: 'audit', requires: 'settings.audit.read' },
  { label: 'Settings', href: '/settings', icon: 'settings', requires: 'settings.org.manage' },
];

/**
 * Developer / diagnostic tools — simulation surfaces that must NOT sit in the
 * primary navigation. Permission-gated; hidden entirely from roles that lack the
 * underlying capability.
 */
export const DEV_TOOLS_NAV: NavItem[] = [
  { label: 'AI Test Lab', href: '/ai/test-lab', icon: 'beaker', requires: 'ai.test_lab.use' },
  {
    label: 'Scoring Test Lab',
    href: '/scoring/test-lab',
    icon: 'beaker',
    requires: 'scoring.evaluation.use',
  },
  {
    label: 'Matching Test Lab',
    href: '/matching/test-lab',
    icon: 'beaker',
    requires: 'matching.evaluation.use',
  },
  { label: 'AI Responder Review', href: '/ai/responder', icon: 'beaker', requires: 'ai.runs.read' },
];

/** Keep only the items the user is permitted to see (pure — unit-tested). */
export function filterNav(items: NavItem[], permissions: Iterable<string>): NavItem[] {
  const perms = permissions instanceof Set ? permissions : new Set(permissions);
  return items.filter((i) => !i.requires || perms.has(i.requires));
}

/** Build the visible, grouped navigation for a permission set. Empty groups drop out. */
export function buildNavGroups(permissions: Iterable<string>): NavGroup[] {
  const perms = permissions instanceof Set ? permissions : new Set(permissions);
  const groups: NavGroup[] = [
    { id: 'primary', label: null, collapsible: false, items: filterNav(PRIMARY_NAV, perms) },
    {
      id: 'admin',
      label: 'Administration',
      collapsible: true,
      items: filterNav(ADMIN_NAV, perms),
    },
    {
      id: 'devtools',
      label: 'Developer tools',
      collapsible: true,
      items: filterNav(DEV_TOOLS_NAV, perms),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Mobile bottom navigation (spec §25). Fixed 5 items, permission-aware. Every
 * destination is a real, permitted page — none route to a teaser/coming-soon.
 */
export interface MobileNavItem {
  key: string;
  label: string;
  href: string;
  icon: 'today' | 'inbox' | 'leads' | 'tasks' | 'more';
  requires?: PermissionKey;
}

export const MOBILE_NAV: MobileNavItem[] = [
  { key: 'today', label: 'Today', href: '/dashboard', icon: 'today' },
  {
    key: 'inbox',
    label: 'Inbox',
    href: '/inbox',
    icon: 'inbox',
    requires: 'conversations.read.assigned',
  },
  { key: 'leads', label: 'Leads', href: '/leads', icon: 'leads', requires: 'leads.read.assigned' },
  { key: 'tasks', label: 'Tasks', href: '/tasks', icon: 'tasks', requires: 'tasks.manage' },
  { key: 'more', label: 'More', href: '/more', icon: 'more' },
];
