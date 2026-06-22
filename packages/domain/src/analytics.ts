/**
 * Phase 9 — Analytics & usage computations (PURE, no IO).
 *
 * Deterministic reducers over RLS-scoped facts the server supplies. No IO, no
 * randomness — given the same inputs they always return the same metrics, so they
 * are exhaustively unit-testable and safe to reuse on the server and in tests.
 */

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

// ---------------------------------------------------------------------------
// 1. Pipeline funnel
// ---------------------------------------------------------------------------

export interface FunnelStageInput {
  stageId: string;
  name: string;
  /** Ordinal position in the pipeline (0 = first). */
  order: number;
  /** Leads currently at OR past this stage (cumulative reach). */
  reached: number;
}

export interface FunnelStageMetric extends FunnelStageInput {
  /** Conversion from the first stage to this stage. */
  conversionFromTop: number;
  /** Conversion from the immediately previous stage. */
  conversionFromPrev: number;
  /** Drop-off from the previous stage (count). */
  droppedFromPrev: number;
}

/**
 * Compute funnel conversion. Stages are sorted by `order`; `reached` should be
 * monotonically non-increasing down the funnel (the server supplies cumulative
 * reach). Conversions are clamped to [0,100].
 */
export function computeFunnel(stages: FunnelStageInput[]): FunnelStageMetric[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const top = sorted[0]?.reached ?? 0;
  return sorted.map((s, i) => {
    const prev = i === 0 ? s.reached : sorted[i - 1]!.reached;
    return {
      ...s,
      conversionFromTop: pct(s.reached, top),
      conversionFromPrev: pct(s.reached, prev),
      droppedFromPrev: Math.max(0, prev - s.reached),
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Lead-source performance
// ---------------------------------------------------------------------------

export interface SourceInput {
  sourceId: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  /** Marketing spend attributed to the source (tenant currency), if known. */
  spend?: number | null;
}

export interface SourceMetric extends SourceInput {
  winRate: number;
  /** Cost per lead (null when spend unknown). */
  costPerLead: number | null;
  /** Cost per acquisition / won deal (null when spend unknown or no wins). */
  costPerWon: number | null;
}

export function computeSourcePerformance(sources: SourceInput[]): SourceMetric[] {
  return sources.map((s) => {
    const spend = s.spend ?? null;
    return {
      ...s,
      winRate: pct(s.won, s.leads),
      costPerLead: spend != null && s.leads > 0 ? Math.round((spend / s.leads) * 100) / 100 : null,
      costPerWon: spend != null && s.won > 0 ? Math.round((spend / s.won) * 100) / 100 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Team / agent performance
// ---------------------------------------------------------------------------

export interface AgentInput {
  agentId: string;
  name: string;
  assigned: number;
  won: number;
  lost: number;
  /** Sum of first-response times in minutes (for averaging). */
  responseMinutesTotal: number;
  responseSamples: number;
}

export interface AgentMetric extends AgentInput {
  winRate: number;
  avgFirstResponseMins: number | null;
  openLeads: number;
}

export function computeTeamPerformance(agents: AgentInput[]): AgentMetric[] {
  return agents.map((a) => ({
    ...a,
    winRate: pct(a.won, a.assigned),
    avgFirstResponseMins:
      a.responseSamples > 0
        ? Math.round((a.responseMinutesTotal / a.responseSamples) * 10) / 10
        : null,
    openLeads: Math.max(0, a.assigned - a.won - a.lost),
  }));
}

// ---------------------------------------------------------------------------
// 4. Usage vs. plan limits
// ---------------------------------------------------------------------------

export interface UsageInput {
  metric: string;
  used: number;
  /** Plan limit; null/Infinity = unlimited. */
  limit: number | null;
}

export interface UsageMetric extends UsageInput {
  utilization: number; // percent of limit, 0 for unlimited
  overLimit: boolean;
  /** True at/above 80% of a finite limit. */
  nearLimit: boolean;
  remaining: number | null;
}

export function computeUsage(usages: UsageInput[]): UsageMetric[] {
  return usages.map((u) => {
    const finite = u.limit != null && Number.isFinite(u.limit);
    const limit = finite ? (u.limit as number) : null;
    const utilization = limit && limit > 0 ? pct(u.used, limit) : 0;
    return {
      ...u,
      utilization,
      overLimit: limit != null && u.used > limit,
      nearLimit: limit != null && limit > 0 && u.used >= 0.8 * limit,
      remaining: limit != null ? Math.max(0, limit - u.used) : null,
    };
  });
}

/** A single headline number: are ANY metered usages over their plan limit? */
export function anyOverLimit(usages: UsageMetric[]): boolean {
  return usages.some((u) => u.overLimit);
}

// ---------------------------------------------------------------------------
// 5. Integration / system health rollup
// ---------------------------------------------------------------------------

export type SystemHealthState = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface HealthSignal {
  component: string;
  state: SystemHealthState;
}

/** The overall state is the WORST component state (never optimistic). */
export function rollupHealth(signals: HealthSignal[]): SystemHealthState {
  if (signals.length === 0) return 'unknown';
  const rank: Record<SystemHealthState, number> = { healthy: 0, unknown: 1, degraded: 2, down: 3 };
  return signals.reduce<SystemHealthState>(
    (worst, s) => (rank[s.state] > rank[worst] ? s.state : worst),
    'healthy',
  );
}

export { pct as percentage };
