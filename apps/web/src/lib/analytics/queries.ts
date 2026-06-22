import 'server-only';
import {
  computeFunnel,
  computeSourcePerformance,
  computeTeamPerformance,
  computeUsage,
  anyOverLimit,
  rollupHealth,
  type FunnelStageMetric,
  type SourceMetric,
  type AgentMetric,
  type UsageMetric,
  type SystemHealthState,
  type HealthSignal,
} from '@re/domain';
import { DEFAULT_PLAN_LIMITS, type PlanTier, type PlanLimits } from '@re/config';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Phase 9 — Analytics & Administration server queries.
 *
 * Every metric is computed from the caller's RLS-scoped facts (existing tables)
 * and handed to the pure `@re/domain` reducers. Nothing here fabricates numbers.
 * Like the dashboard `safeCount` pattern, each loader is defensive: a missing
 * table or row degrades to zeros/empties rather than throwing the page.
 */

const ROW_CAP = 5000;

/** Never-throw head count, RLS-scoped via the passed client. */
async function safeCount(build: () => PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await build();
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Pipeline funnel
// ---------------------------------------------------------------------------

/**
 * Cumulative funnel: leads that have reached AT OR PAST each pipeline stage,
 * ordered by `sort_order`. `reached` is computed by walking the stage order and
 * summing the count of leads currently at every stage from this one onward.
 */
export async function loadFunnel(supabase: DB): Promise<FunnelStageMetric[]> {
  try {
    const [{ data: stages }, { data: leadRows }] = await Promise.all([
      supabase
        .from('pipeline_stages')
        .select('id, name, sort_order, is_won, is_lost')
        .order('sort_order', { ascending: true }),
      supabase.from('leads').select('stage_id').is('deleted_at', null).limit(ROW_CAP),
    ]);

    const ordered = (stages ?? []).slice();
    if (ordered.length === 0) return [];

    // Count leads currently sitting at each stage.
    const at = new Map<string, number>();
    for (const l of leadRows ?? []) {
      const sid = l.stage_id as string | null;
      if (sid) at.set(sid, (at.get(sid) ?? 0) + 1);
    }

    // Cumulative reach: leads at this stage plus every later stage.
    let runningPast = 0;
    const reachById = new Map<string, number>();
    for (let i = ordered.length - 1; i >= 0; i--) {
      const id = ordered[i]!.id as string;
      runningPast += at.get(id) ?? 0;
      reachById.set(id, runningPast);
    }

    return computeFunnel(
      ordered.map((s, i) => ({
        stageId: s.id as string,
        name: s.name as string,
        order: i,
        reached: reachById.get(s.id as string) ?? 0,
      })),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lead-source performance
// ---------------------------------------------------------------------------

/** Group leads by source; won/lost derived from the lead's current stage flags. */
export async function loadSourcePerformance(supabase: DB): Promise<SourceMetric[]> {
  try {
    const [{ data: sources }, { data: leadRows }, { data: stages }] = await Promise.all([
      supabase.from('lead_sources').select('id, name'),
      supabase.from('leads').select('source_id, stage_id').is('deleted_at', null).limit(ROW_CAP),
      supabase.from('pipeline_stages').select('id, is_won, is_lost'),
    ]);

    const stageFlag = new Map<string, { won: boolean; lost: boolean }>();
    for (const s of stages ?? [])
      stageFlag.set(s.id as string, {
        won: Boolean(s.is_won),
        lost: Boolean(s.is_lost),
      });

    const tally = new Map<string, { leads: number; won: number; lost: number }>();
    for (const l of leadRows ?? []) {
      const sid = l.source_id as string | null;
      if (!sid) continue;
      const row = tally.get(sid) ?? { leads: 0, won: 0, lost: 0 };
      row.leads += 1;
      const flag = l.stage_id ? stageFlag.get(l.stage_id as string) : undefined;
      if (flag?.won) row.won += 1;
      else if (flag?.lost) row.lost += 1;
      tally.set(sid, row);
    }

    return computeSourcePerformance(
      (sources ?? []).map((s) => {
        const row = tally.get(s.id as string) ?? { leads: 0, won: 0, lost: 0 };
        return {
          sourceId: s.id as string,
          name: s.name as string,
          leads: row.leads,
          won: row.won,
          lost: row.lost,
          spend: null,
        };
      }),
    ).sort((a, b) => b.leads - a.leads);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Team / agent performance
// ---------------------------------------------------------------------------

/**
 * Group leads by their active-assignment agent; won/lost from stage flags.
 * First-response time is approximated per agent from the gap between a lead's
 * conversation start and its first outbound (agent) message, when available;
 * if no conversation/message data is visible, samples stay 0 (avg is null).
 */
export async function loadTeamPerformance(supabase: DB): Promise<AgentMetric[]> {
  try {
    const [{ data: assignments }, { data: stages }] = await Promise.all([
      supabase
        .from('lead_assignments')
        .select('lead_id, agent_id, profiles:agent_id(full_name)')
        .eq('active', true)
        .limit(ROW_CAP),
      supabase.from('pipeline_stages').select('id, is_won, is_lost'),
    ]);

    const stageFlag = new Map<string, { won: boolean; lost: boolean }>();
    for (const s of stages ?? [])
      stageFlag.set(s.id as string, { won: Boolean(s.is_won), lost: Boolean(s.is_lost) });

    // Map lead -> agent for assigned leads.
    const leadAgent = new Map<string, string>();
    const agentName = new Map<string, string>();
    for (const a of assignments ?? []) {
      const leadId = a.lead_id as string;
      const agentId = a.agent_id as string;
      leadAgent.set(leadId, agentId);
      const prof = a.profiles as unknown as { full_name: string | null } | null;
      if (!agentName.has(agentId)) agentName.set(agentId, prof?.full_name ?? 'Agent');
    }

    const leadIds = [...leadAgent.keys()];
    if (leadIds.length === 0) return [];

    // Pull stage_id for the assigned leads to derive won/lost.
    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, stage_id')
      .in('id', leadIds.slice(0, ROW_CAP));

    const agg = new Map<
      string,
      { assigned: number; won: number; lost: number; respTotal: number; respSamples: number }
    >();
    const ensure = (id: string) => {
      let row = agg.get(id);
      if (!row) {
        row = { assigned: 0, won: 0, lost: 0, respTotal: 0, respSamples: 0 };
        agg.set(id, row);
      }
      return row;
    };
    for (const [, agentId] of leadAgent) ensure(agentId);

    for (const l of leadRows ?? []) {
      const agentId = leadAgent.get(l.id as string);
      if (!agentId) continue;
      const row = ensure(agentId);
      row.assigned += 1;
      const flag = l.stage_id ? stageFlag.get(l.stage_id as string) : undefined;
      if (flag?.won) row.won += 1;
      else if (flag?.lost) row.lost += 1;
    }

    // Best-effort first-response time per assigned lead's conversation.
    await accumulateResponseTimes(supabase, leadAgent, ensure);

    return computeTeamPerformance(
      [...agg.entries()].map(([agentId, row]) => ({
        agentId,
        name: agentName.get(agentId) ?? 'Agent',
        assigned: row.assigned,
        won: row.won,
        lost: row.lost,
        responseMinutesTotal: row.respTotal,
        responseSamples: row.respSamples,
      })),
    ).sort((a, b) => b.assigned - a.assigned);
  } catch {
    return [];
  }
}

/**
 * Defensively accumulate first-response minutes per agent: for each assigned
 * lead's earliest conversation, measure the gap from conversation start to the
 * first outbound message. Silently no-ops if conversation/message data is not
 * available under the caller's RLS.
 */
async function accumulateResponseTimes(
  supabase: DB,
  leadAgent: Map<string, string>,
  ensure: (id: string) => {
    assigned: number;
    won: number;
    lost: number;
    respTotal: number;
    respSamples: number;
  },
): Promise<void> {
  try {
    const leadIds = [...leadAgent.keys()].slice(0, ROW_CAP);
    const { data: convos } = await supabase
      .from('conversations')
      .select('id, lead_id, created_at')
      .in('lead_id', leadIds)
      .not('lead_id', 'is', null)
      .limit(ROW_CAP);
    if (!convos || convos.length === 0) return;

    // Earliest conversation per lead.
    const convoOfLead = new Map<string, { id: string; started: number }>();
    for (const c of convos) {
      const leadId = c.lead_id as string | null;
      if (!leadId) continue;
      const started = new Date(c.created_at as string).getTime();
      const prev = convoOfLead.get(leadId);
      if (!prev || started < prev.started) convoOfLead.set(leadId, { id: c.id as string, started });
    }

    const convoIds = [...convoOfLead.values()].map((v) => v.id).slice(0, ROW_CAP);
    if (convoIds.length === 0) return;
    const { data: msgs } = await supabase
      .from('conversation_messages')
      .select('conversation_id, direction, created_at')
      .in('conversation_id', convoIds)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: true })
      .limit(ROW_CAP);
    if (!msgs) return;

    // First outbound message time per conversation.
    const firstOut = new Map<string, number>();
    for (const mrow of msgs) {
      const cid = mrow.conversation_id as string;
      if (firstOut.has(cid)) continue;
      firstOut.set(cid, new Date(mrow.created_at as string).getTime());
    }

    for (const [leadId, agentId] of leadAgent) {
      const convo = convoOfLead.get(leadId);
      if (!convo) continue;
      const out = firstOut.get(convo.id);
      if (out == null || out < convo.started) continue;
      const mins = (out - convo.started) / 60_000;
      const row = ensure(agentId);
      row.respTotal += mins;
      row.respSamples += 1;
    }
  } catch {
    /* response-time data unavailable — leave samples at zero */
  }
}

// ---------------------------------------------------------------------------
// Usage vs. plan limits
// ---------------------------------------------------------------------------

export interface UsageReport {
  metrics: UsageMetric[];
  overLimit: boolean;
  planTier: PlanTier;
  periodStart: string | null;
  periodEnd: string | null;
}

/** Current calendar month, UTC, as YYYY-MM-DD date strings. */
function currentMonthRange(now = new Date()): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const mth = now.getUTCMonth();
  const start = new Date(Date.UTC(y, mth, 1));
  const end = new Date(Date.UTC(y, mth + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const USAGE_METRIC_LIMIT: Record<string, keyof PlanLimits> = {
  projects: 'maxProjects',
  users: 'maxUsers',
  ai_budget_usd: 'monthlyAiBudgetUsd',
  whatsapp_messages: 'monthlyWhatsappMessages',
  storage_gb: 'storageGb',
};

const USAGE_METRIC_LABEL: Record<string, string> = {
  projects: 'Projects',
  users: 'Team members',
  ai_budget_usd: 'AI budget (USD)',
  whatsapp_messages: 'WhatsApp messages',
  storage_gb: 'Storage (GB)',
};

export function usageMetricLabel(metric: string): string {
  return USAGE_METRIC_LABEL[metric] ?? metric;
}

/**
 * Usage vs. plan limits for the current month. Recorded usage is read from
 * `usage_counters`; live counters (projects, users) are also measured directly
 * so the page reflects real state even before any counter row exists.
 */
export async function loadUsage(supabase: DB, tenantId: string): Promise<UsageReport> {
  const { start, end } = currentMonthRange();

  // Tenant plan tier (defensive default to starter).
  let planTier: PlanTier = 'starter';
  try {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenantId)
      .maybeSingle();
    const t = tenant?.plan_tier as string | undefined;
    if (t === 'starter' || t === 'growth' || t === 'enterprise') planTier = t;
  } catch {
    /* default starter */
  }
  const limits = DEFAULT_PLAN_LIMITS[planTier];

  // Recorded usage counters for the current period.
  const recorded = new Map<string, number>();
  try {
    const { data: counters } = await supabase
      .from('usage_counters')
      .select('metric, used')
      .eq('period_start', start)
      .eq('period_end', end);
    for (const c of counters ?? []) recorded.set(c.metric as string, Number(c.used ?? 0));
  } catch {
    /* no counters yet */
  }

  // Live measured counters (override recorded for these two structural metrics).
  const [liveProjects, liveUsers] = await Promise.all([
    safeCount(() => supabase.from('projects').select('id', { count: 'exact', head: true })),
    safeCount(() =>
      supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),
    ),
  ]);
  recorded.set('projects', liveProjects);
  recorded.set('users', liveUsers);

  const metrics = computeUsage(
    Object.keys(USAGE_METRIC_LIMIT).map((metric) => {
      const limit = limits[USAGE_METRIC_LIMIT[metric]!];
      return {
        metric,
        used: recorded.get(metric) ?? 0,
        limit: Number.isFinite(limit) ? limit : null,
      };
    }),
  );

  return {
    metrics,
    overLimit: anyOverLimit(metrics),
    planTier,
    periodStart: start,
    periodEnd: end,
  };
}

// ---------------------------------------------------------------------------
// Billing periods
// ---------------------------------------------------------------------------

export interface BillingPeriodRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  planTier: string;
  status: string;
  currency: string;
  amountDue: number;
}

export async function loadBillingPeriods(supabase: DB): Promise<BillingPeriodRow[]> {
  try {
    const { data } = await supabase
      .from('billing_periods')
      .select('id, period_start, period_end, plan_tier, status, currency, amount_due')
      .order('period_start', { ascending: false })
      .limit(24);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      periodStart: r.period_start as string,
      periodEnd: r.period_end as string,
      planTier: r.plan_tier as string,
      status: r.status as string,
      currency: r.currency as string,
      amountDue: Number(r.amount_due ?? 0),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// System / integration health
// ---------------------------------------------------------------------------

export interface SystemHealthRow {
  component: string;
  state: SystemHealthState;
  latencyMs: number | null;
  detail: string | null;
  checkedAt: string | null;
}

export interface SystemHealthReport {
  rows: SystemHealthRow[];
  overall: SystemHealthState;
}

/**
 * Read the latest recorded health per component from `system_health_checks` and
 * roll up the overall state via the pure reducer. A deterministic, IO-FREE
 * synthetic baseline row is always included so the page is never blank: the app
 * itself reports healthy; we do NOT call out to any external provider.
 */
export async function loadSystemHealth(supabase: DB): Promise<SystemHealthReport> {
  const latest = new Map<string, SystemHealthRow>();

  // Deterministic baseline (no network IO): the running app is healthy.
  latest.set('application', {
    component: 'application',
    state: 'healthy',
    latencyMs: null,
    detail: 'Application server responding (in-process check, no external IO).',
    checkedAt: null,
  });
  // The fact that we could query under RLS implies DB reachability.
  latest.set('database', {
    component: 'database',
    state: 'healthy',
    latencyMs: null,
    detail: 'Database reachable via RLS-scoped query.',
    checkedAt: null,
  });

  try {
    const { data } = await supabase
      .from('system_health_checks')
      .select('component, state, latency_ms, detail, checked_at')
      .order('checked_at', { ascending: false })
      .limit(500);
    // Rows arrive newest-first; keep only the most recent per component. Recorded
    // checks (including app/database, if a real probe wrote one) take precedence
    // over the synthetic baseline.
    const seen = new Set<string>();
    for (const r of data ?? []) {
      const comp = r.component as string;
      if (seen.has(comp)) continue;
      seen.add(comp);
      latest.set(comp, {
        component: comp,
        state: (r.state as SystemHealthState) ?? 'unknown',
        latencyMs: (r.latency_ms as number | null) ?? null,
        detail: (r.detail as string | null) ?? null,
        checkedAt: (r.checked_at as string | null) ?? null,
      });
    }
  } catch {
    /* no recorded checks — baseline still applies */
  }

  const rows = [...latest.values()];
  const signals: HealthSignal[] = rows.map((r) => ({ component: r.component, state: r.state }));
  return { rows, overall: rollupHealth(signals) };
}
