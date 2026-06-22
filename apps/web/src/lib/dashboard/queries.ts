import 'server-only';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MetricKey, PanelKey } from './config';

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const FRESHNESS_DAYS = 30;

function startOfTodayISO(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function daysAgoISO(n: number, now = new Date()): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}
function daysAheadISO(n: number, now = new Date()): string {
  return new Date(now.getTime() + n * 86_400_000).toISOString();
}

/** A head-only count that never throws (RLS-scoped via the passed client). */
async function safeCount(build: () => PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await build();
    return count ?? 0;
  } catch {
    return 0;
  }
}

export type DashboardMetrics = Partial<Record<MetricKey, number>>;

export interface AttentionLead {
  id: string;
  name: string;
  stageName: string | null;
  category: string | null;
  status: string;
  reason: string;
  updatedAt: string;
}
export interface TaskRow {
  id: string;
  title: string;
  leadName: string | null;
  dueAt: string | null;
  bucket: 'overdue' | 'today' | 'upcoming';
}
export interface ConversationRow {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  waiting: boolean;
  lastInboundAt: string | null;
}
export interface PipelineStageSummary {
  name: string;
  count: number;
  pct: number;
}
export interface ActivityRow {
  action: string;
  entityType: string | null;
  at: string;
}
export interface SourceSummary {
  name: string;
  count: number;
}

export interface DashboardPanels {
  leadsAttention?: AttentionLead[];
  tasksDue?: TaskRow[];
  recentConversations?: ConversationRow[];
  pipelineOverview?: PipelineStageSummary[];
  inventoryAlerts?: { available: number; stale: number; needsVerification: number };
  recentActivity?: ActivityRow[];
  leadSources?: SourceSummary[];
}

export interface DashboardData {
  metrics: DashboardMetrics;
  panels: DashboardPanels;
}

/**
 * Compute all role-permitted metrics + panels under the caller's RLS. Every query
 * is dispatched concurrently (metrics and panels run in parallel) so the page
 * does not wait on a chain of sequential round-trips.
 */
export async function loadDashboard(
  supabase: DB,
  opts: { tenantId: string; metricKeys: MetricKey[]; panelKeys: PanelKey[]; now?: Date },
): Promise<DashboardData> {
  const now = opts.now ?? new Date();
  const wantM = new Set(opts.metricKeys);
  const wantP = new Set(opts.panelKeys);
  const leads = () => supabase.from('leads').select('id', { count: 'exact', head: true });
  const metrics: DashboardMetrics = {};

  // ---- KPI metrics: build promises up-front so they all run concurrently ----
  const m: Array<[MetricKey, Promise<number>]> = [];
  if (wantM.has('newLeadsToday'))
    m.push([
      'newLeadsToday',
      safeCount(() => leads().is('deleted_at', null).gte('created_at', startOfTodayISO(now))),
    ]);
  if (wantM.has('newLeadsWeek'))
    m.push([
      'newLeadsWeek',
      safeCount(() => leads().is('deleted_at', null).gte('created_at', daysAgoISO(7, now))),
    ]);
  if (wantM.has('leadVolume'))
    m.push([
      'leadVolume',
      safeCount(() => leads().is('deleted_at', null).gte('created_at', daysAgoISO(30, now))),
    ]);
  if (wantM.has('hotLeads'))
    m.push(['hotLeads', safeCount(() => leads().is('deleted_at', null).eq('category', 'hot'))]);
  if (wantM.has('warmLeads'))
    m.push(['warmLeads', safeCount(() => leads().is('deleted_at', null).eq('category', 'warm'))]);
  if (wantM.has('openConversations'))
    m.push([
      'openConversations',
      safeCount(() =>
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'closed'),
      ),
    ]);
  if (wantM.has('waitingConversations'))
    m.push([
      'waitingConversations',
      safeCount(() =>
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'closed')
          .eq('needs_response', true),
      ),
    ]);
  if (wantM.has('overdueTasks'))
    m.push([
      'overdueTasks',
      safeCount(() =>
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .not('due_at', 'is', null)
          .lt('due_at', now.toISOString()),
      ),
    ]);
  if (wantM.has('upcomingTasks'))
    m.push([
      'upcomingTasks',
      safeCount(() =>
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .gte('due_at', now.toISOString())
          .lte('due_at', daysAheadISO(7, now)),
      ),
    ]);
  if (wantM.has('availableInventory'))
    m.push([
      'availableInventory',
      safeCount(() =>
        supabase
          .from('inventory_units')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'available'),
      ),
    ]);
  if (wantM.has('staleInventory') || wantM.has('unitsNeedingVerification')) {
    const stale = safeCount(() =>
      supabase
        .from('inventory_units')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'available')
        .or(`last_verified_at.is.null,last_verified_at.lt.${daysAgoISO(FRESHNESS_DAYS, now)}`),
    );
    if (wantM.has('staleInventory')) m.push(['staleInventory', stale]);
    if (wantM.has('unitsNeedingVerification')) m.push(['unitsNeedingVerification', stale]);
  }
  if (wantM.has('teamMembers'))
    m.push([
      'teamMembers',
      safeCount(() =>
        supabase
          .from('memberships')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', opts.tenantId)
          .eq('status', 'active'),
      ),
    ]);
  if (wantM.has('activeProjects'))
    m.push([
      'activeProjects',
      safeCount(() => supabase.from('projects').select('id', { count: 'exact', head: true })),
    ]);
  if (wantM.has('leadSources'))
    m.push([
      'leadSources',
      safeCount(() => supabase.from('lead_sources').select('id', { count: 'exact', head: true })),
    ]);
  if (wantM.has('unassignedLeads')) {
    // Unassigned = visible leads minus leads with an active assignment (both RLS-scoped).
    const total = safeCount(() => leads().is('deleted_at', null));
    const assigned = safeCount(() =>
      supabase
        .from('lead_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('active', true),
    );
    m.push([
      'unassignedLeads',
      Promise.all([total, assigned]).then(([t, a]) => Math.max(0, t - a)),
    ]);
  }

  // ---- Panels: each loader is independent; collect then run concurrently ----
  const panels: DashboardPanels = {};
  const panelTasks: Promise<void>[] = [];

  if (wantP.has('leadsAttention'))
    panelTasks.push(
      (async () => {
        try {
          const { data } = await supabase
            .from('leads')
            .select(
              'id, full_name, category, operational_status, updated_at, pipeline_stages:stage_id(name)',
            )
            .is('deleted_at', null)
            .or('category.eq.hot,category.eq.warm,operational_status.eq.new')
            .order('updated_at', { ascending: false })
            .limit(6);
          panels.leadsAttention = (data ?? []).map((r) => {
            const stage = r.pipeline_stages as unknown as { name: string } | null;
            const cat = (r.category as string | null) ?? null;
            const reason =
              cat === 'hot' ? 'Hot lead' : cat === 'warm' ? 'Warm lead' : 'New — not yet contacted';
            return {
              id: r.id as string,
              name: (r.full_name as string | null) ?? 'Unnamed lead',
              stageName: stage?.name ?? null,
              category: cat,
              status: r.operational_status as string,
              reason,
              updatedAt: r.updated_at as string,
            };
          });
        } catch {
          panels.leadsAttention = [];
        }
      })(),
    );

  if (wantP.has('tasksDue'))
    panelTasks.push(
      (async () => {
        try {
          const { data } = await supabase
            .from('tasks')
            .select('id, title, due_at, status, leads:lead_id(full_name)')
            .eq('status', 'open')
            .order('due_at', { ascending: true, nullsFirst: false })
            .limit(6);
          const nowMs = now.getTime();
          panels.tasksDue = (data ?? []).map((r) => {
            const lead = r.leads as unknown as { full_name: string | null } | null;
            const due = r.due_at as string | null;
            const ms = due ? new Date(due).getTime() : null;
            const bucket: TaskRow['bucket'] =
              ms === null
                ? 'upcoming'
                : ms < nowMs
                  ? 'overdue'
                  : ms < nowMs + 86_400_000
                    ? 'today'
                    : 'upcoming';
            return {
              id: r.id as string,
              title: r.title as string,
              leadName: lead?.full_name ?? null,
              dueAt: due,
              bucket,
            };
          });
        } catch {
          panels.tasksDue = [];
        }
      })(),
    );

  if (wantP.has('recentConversations'))
    panelTasks.push(
      (async () => {
        try {
          // Metadata only — no message bodies are selected.
          const { data } = await supabase
            .from('conversations')
            .select('id, channel, status, subject, needs_response, last_inbound_at')
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(6);
          panels.recentConversations = (data ?? []).map((r) => ({
            id: r.id as string,
            channel: r.channel as string,
            status: r.status as string,
            subject: (r.subject as string | null) ?? null,
            waiting: Boolean(r.needs_response),
            lastInboundAt: (r.last_inbound_at as string | null) ?? null,
          }));
        } catch {
          panels.recentConversations = [];
        }
      })(),
    );

  if (wantP.has('pipelineOverview'))
    panelTasks.push(
      (async () => {
        try {
          const [{ data: stages }, { data: leadRows }] = await Promise.all([
            supabase
              .from('pipeline_stages')
              .select('id, name, sort_order')
              .order('sort_order', { ascending: true }),
            supabase.from('leads').select('stage_id').is('deleted_at', null).limit(2000),
          ]);
          const tally = new Map<string, number>();
          for (const l of leadRows ?? []) {
            const sid = l.stage_id as string | null;
            if (sid) tally.set(sid, (tally.get(sid) ?? 0) + 1);
          }
          const total = [...tally.values()].reduce((a, b) => a + b, 0) || 1;
          panels.pipelineOverview = (stages ?? []).map((s) => {
            const count = tally.get(s.id as string) ?? 0;
            return { name: s.name as string, count, pct: Math.round((count / total) * 100) };
          });
        } catch {
          panels.pipelineOverview = [];
        }
      })(),
    );

  if (wantP.has('inventoryAlerts'))
    panelTasks.push(
      (async () => {
        const [available, stale] = await Promise.all([
          safeCount(() =>
            supabase
              .from('inventory_units')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'available'),
          ),
          safeCount(() =>
            supabase
              .from('inventory_units')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'available')
              .or(
                `last_verified_at.is.null,last_verified_at.lt.${daysAgoISO(FRESHNESS_DAYS, now)}`,
              ),
          ),
        ]);
        panels.inventoryAlerts = { available, stale, needsVerification: stale };
      })(),
    );

  if (wantP.has('recentActivity'))
    panelTasks.push(
      (async () => {
        try {
          // Action + entity + time only — never previous/new values (may carry PII).
          const { data } = await supabase
            .from('audit_logs')
            .select('action, entity_type, created_at')
            .order('created_at', { ascending: false })
            .limit(8);
          panels.recentActivity = (data ?? []).map((r) => ({
            action: r.action as string,
            entityType: (r.entity_type as string | null) ?? null,
            at: r.created_at as string,
          }));
        } catch {
          panels.recentActivity = [];
        }
      })(),
    );

  if (wantP.has('leadSources'))
    panelTasks.push(
      (async () => {
        try {
          const [{ data: sources }, { data: leadRows }] = await Promise.all([
            supabase.from('lead_sources').select('id, name'),
            supabase.from('leads').select('source_id').is('deleted_at', null).limit(2000),
          ]);
          const tally = new Map<string, number>();
          for (const l of leadRows ?? []) {
            const sid = l.source_id as string | null;
            if (sid) tally.set(sid, (tally.get(sid) ?? 0) + 1);
          }
          panels.leadSources = (sources ?? [])
            .map((s) => ({ name: s.name as string, count: tally.get(s.id as string) ?? 0 }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
        } catch {
          panels.leadSources = [];
        }
      })(),
    );

  // Await metrics + panels together.
  await Promise.all([
    ...m.map(async ([k, p]) => {
      metrics[k] = await p;
    }),
    ...panelTasks,
  ]);

  return { metrics, panels };
}
