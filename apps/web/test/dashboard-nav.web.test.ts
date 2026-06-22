import { describe, it, expect } from 'vitest';
import {
  buildNavGroups,
  filterNav,
  PRIMARY_NAV,
  ADMIN_NAV,
  DEV_TOOLS_NAV,
} from '@/components/app-shell/nav-config';
import {
  resolveDashboardVariant,
  visibleKpis,
  quickActions,
  greeting,
  firstName,
  environmentBadge,
  VARIANT_PANELS,
  KPI_DEFS,
} from '@/lib/dashboard/config';

const ADMIN_PERMS = [
  'leads.read.assigned',
  'leads.read.team',
  'leads.read.all',
  'leads.create',
  'conversations.read.assigned',
  'conversations.read.metadata',
  'tasks.manage',
  'projects.read',
  'projects.manage',
  'inventory.read',
  'inventory.import',
  'knowledge.read',
  'team.performance.read',
  'scoring.models.read',
  'matching.models.read',
  'settings.org.manage',
  'settings.audit.read',
  'ai.test_lab.use',
  'ai.runs.read',
  'scoring.evaluation.use',
  'matching.evaluation.use',
];
const AGENT_PERMS = [
  'leads.read.assigned',
  'leads.create',
  'conversations.read.assigned',
  'tasks.manage',
  'projects.read',
  'inventory.read',
  'knowledge.read',
];
describe('navigation grouping + permission gating', () => {
  it('test/diagnostic pages never appear in primary nav', () => {
    const primaryHrefs = PRIMARY_NAV.map((i) => i.href);
    for (const h of ['/ai/test-lab', '/scoring/test-lab', '/matching/test-lab', '/ai/responder']) {
      expect(primaryHrefs).not.toContain(h);
    }
    expect(DEV_TOOLS_NAV.map((i) => i.href)).toContain('/ai/test-lab');
  });

  it('admin sees all three groups; agent sees no admin/devtools groups', () => {
    const admin = buildNavGroups(ADMIN_PERMS).map((g) => g.id);
    expect(admin).toEqual(['primary', 'admin', 'devtools']);
    const agent = buildNavGroups(AGENT_PERMS).map((g) => g.id);
    expect(agent).toEqual(['primary']);
  });

  it('does not advertise inaccessible pages', () => {
    const adminItems = filterNav(ADMIN_NAV, AGENT_PERMS);
    expect(adminItems).toHaveLength(0);
    const dash = filterNav(PRIMARY_NAV, []); // only Dashboard has no requirement
    expect(dash.map((i) => i.href)).toEqual(['/dashboard']);
  });
});

describe('dashboard role variant resolution', () => {
  it('maps known role slugs', () => {
    expect(resolveDashboardVariant('client_admin', [])).toBe('admin');
    expect(resolveDashboardVariant('sales_manager', [])).toBe('manager');
    expect(resolveDashboardVariant('sales_agent', [])).toBe('agent');
    expect(resolveDashboardVariant('marketing_manager', [])).toBe('marketing');
    expect(resolveDashboardVariant('project_maintenance', [])).toBe('project');
    expect(resolveDashboardVariant('viewer', [])).toBe('viewer');
  });
  it('falls back to permissions for unknown roles', () => {
    expect(resolveDashboardVariant('custom', ['settings.org.manage'])).toBe('admin');
    expect(resolveDashboardVariant('custom', ['leads.read.assigned'])).toBe('agent');
    expect(resolveDashboardVariant('custom', [])).toBe('viewer');
  });
});

describe('role-safe content selection', () => {
  it('marketing dashboard is metadata-only (no lead/task/conversation panels)', () => {
    const panels = VARIANT_PANELS.marketing;
    expect(panels).not.toContain('leadsAttention');
    expect(panels).not.toContain('tasksDue');
    expect(panels).not.toContain('recentConversations');
    expect(panels).toContain('pipelineOverview');
    expect(panels).toContain('leadSources');
  });

  it('agent KPIs drop cards the agent lacks permission for (no team-only counts)', () => {
    const keys = visibleKpis('manager', AGENT_PERMS);
    expect(keys).not.toContain('unassignedLeads'); // requires leads.read.team
    expect(keys).toContain('newLeadsToday');
  });

  it('viewer gets no quick actions; admin gets create actions', () => {
    expect(quickActions([])).toHaveLength(0);
    const labels = quickActions(ADMIN_PERMS).map((a) => a.label);
    expect(labels).toContain('Add lead');
    expect(labels).toContain('Open inbox');
  });

  it('KPI destinations preserve filters', () => {
    expect(KPI_DEFS.newLeadsToday.href).toContain('range=today');
    expect(KPI_DEFS.unassignedLeads.href).toContain('filter=unassigned');
    expect(KPI_DEFS.staleInventory.href).toContain('filter=stale');
  });
});

describe('header helpers', () => {
  it('greeting respects time of day', () => {
    expect(greeting(new Date('2026-06-22T08:00:00'))).toBe('Good morning');
    expect(greeting(new Date('2026-06-22T13:00:00'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-06-22T20:00:00'))).toBe('Good evening');
  });
  it('firstName prefers full name, falls back to email local part', () => {
    expect(firstName('Asha Rao', 'a@x.com')).toBe('Asha');
    expect(firstName(null, 'rishav@sthyra.com')).toBe('rishav');
    expect(firstName('  ', 'x@y.com')).toBe('x');
  });
  it('environment badge reflects profile + env', () => {
    expect(environmentBadge('controlled_mvp', 'local')).toBe('Controlled MVP');
    expect(environmentBadge('controlled_mvp', 'staging')).toBe('Staging · Controlled MVP');
    expect(environmentBadge('controlled_mvp', 'production')).toBe('Controlled MVP');
    expect(environmentBadge('full', 'production')).toBeNull();
  });
});
