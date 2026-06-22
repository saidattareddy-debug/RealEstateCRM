/**
 * Token / cost / usage limits and circuit breaker (Phase 5A §20). Pure &
 * deterministic. When a limit is exceeded the system must NOT generate a
 * customer-visible response — it records a safe usage status and lets a human
 * respond. No retry storms.
 */

export interface UsageLimits {
  tenantDailyTokens: number;
  tenantMonthlyTokens: number;
  perConversationTokens: number;
  perRequestInputTokens: number;
  perRequestOutputTokens: number;
  retrievalResultLimit: number;
  toolCallLimit: number;
  maxRetries: number;
}

export interface UsageState {
  tenantTokensToday: number;
  tenantTokensThisMonth: number;
  conversationTokens: number;
  /** Consecutive provider failures (circuit-breaker input). */
  consecutiveFailures: number;
}

export interface RequestEstimate {
  inputTokens: number;
  expectedOutputTokens: number;
}

export type UsageBlock =
  | 'tenant_daily_limit'
  | 'tenant_monthly_limit'
  | 'conversation_limit'
  | 'request_input_limit'
  | 'request_output_limit'
  | 'circuit_open';

export interface UsageDecision {
  allowed: boolean;
  blocks: UsageBlock[];
  circuitOpen: boolean;
}

const CIRCUIT_THRESHOLD = 5;

export function checkUsage(
  limits: UsageLimits,
  state: UsageState,
  req: RequestEstimate,
): UsageDecision {
  const blocks: UsageBlock[] = [];
  const circuitOpen = state.consecutiveFailures >= CIRCUIT_THRESHOLD;
  if (circuitOpen) blocks.push('circuit_open');
  if (req.inputTokens > limits.perRequestInputTokens) blocks.push('request_input_limit');
  if (req.expectedOutputTokens > limits.perRequestOutputTokens) blocks.push('request_output_limit');
  if (state.tenantTokensToday + req.inputTokens > limits.tenantDailyTokens)
    blocks.push('tenant_daily_limit');
  if (state.tenantTokensThisMonth + req.inputTokens > limits.tenantMonthlyTokens)
    blocks.push('tenant_monthly_limit');
  if (state.conversationTokens + req.inputTokens > limits.perConversationTokens)
    blocks.push('conversation_limit');
  return { allowed: blocks.length === 0, blocks, circuitOpen };
}

/** Clamp retrieval/tool fan-out to the configured limits. */
export function clampFanout(
  limits: UsageLimits,
  requested: { retrievalResults: number; toolCalls: number },
): { retrievalResults: number; toolCalls: number } {
  return {
    retrievalResults: Math.max(
      0,
      Math.min(requested.retrievalResults, limits.retrievalResultLimit),
    ),
    toolCalls: Math.max(0, Math.min(requested.toolCalls, limits.toolCallLimit)),
  };
}

/** Whether another retry is permitted (no retry storms). */
export function mayRetry(limits: UsageLimits, attempt: number, retryableError: boolean): boolean {
  return retryableError && attempt < limits.maxRetries;
}

/** Rough cost estimate in micro-currency units (deterministic, for tracing). */
export function estimateCostMicros(
  usage: { inputTokens: number; outputTokens: number },
  rate: { inputPerKiloMicros: number; outputPerKiloMicros: number },
): number {
  return Math.round(
    (usage.inputTokens / 1000) * rate.inputPerKiloMicros +
      (usage.outputTokens / 1000) * rate.outputPerKiloMicros,
  );
}
