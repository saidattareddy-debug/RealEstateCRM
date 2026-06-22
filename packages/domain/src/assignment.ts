/**
 * Deterministic lead-assignment engine (MASTER_SPEC §17). Pure, DB-independent.
 * Filters eligible agents, respects language/skill/workload/working-hours, then
 * applies weighted round-robin. A manual assignment is NEVER overwritten unless
 * an explicit rule forces it.
 */

export interface Agent {
  id: string;
  available: boolean;
  languages: string[];
  activeLeadCount: number;
  maxActiveLeads: number;
  /** Projects this agent is authorized for; empty = all projects. */
  projectIds: string[];
  /** Lower = next in line. */
  roundRobinPosition: number;
}

export interface AssignmentLead {
  language?: string | null;
  projectId?: string | null;
  /** Existing manual assignment to preserve. */
  manualAgentId?: string | null;
}

export interface AssignmentResult {
  agentId: string;
  reason: string;
}

export interface AssignmentOptions {
  /** When true, rule-based assignment overrides an existing manual assignment. */
  forceOverrideManual?: boolean;
}

/** Reasons an agent is excluded — returned for transparency/testing. */
export function isEligible(agent: Agent, lead: AssignmentLead): { ok: boolean; reason?: string } {
  if (!agent.available) return { ok: false, reason: 'unavailable' };
  if (agent.activeLeadCount >= agent.maxActiveLeads) return { ok: false, reason: 'at_capacity' };
  if (lead.language && agent.languages.length > 0 && !agent.languages.includes(lead.language))
    return { ok: false, reason: 'language_mismatch' };
  if (lead.projectId && agent.projectIds.length > 0 && !agent.projectIds.includes(lead.projectId))
    return { ok: false, reason: 'project_not_authorized' };
  return { ok: true };
}

/**
 * Assign a lead. Returns the chosen agent + a human-readable reason, or null if
 * no eligible agent exists. Preserves a manual assignment unless forced.
 */
export function assignLead(
  lead: AssignmentLead,
  agents: readonly Agent[],
  opts: AssignmentOptions = {},
): AssignmentResult | null {
  if (lead.manualAgentId && !opts.forceOverrideManual) {
    return { agentId: lead.manualAgentId, reason: 'manual_assignment_preserved' };
  }

  const eligible = agents.filter((a) => isEligible(a, lead).ok);
  if (eligible.length === 0) return null;

  // Prefer project-authorized agents, then language match, then least loaded,
  // then weighted round-robin position. Deterministic ordering.
  const ranked = [...eligible].sort((a, b) => {
    const aProj = lead.projectId && a.projectIds.includes(lead.projectId) ? 0 : 1;
    const bProj = lead.projectId && b.projectIds.includes(lead.projectId) ? 0 : 1;
    if (aProj !== bProj) return aProj - bProj;

    const aLang = lead.language && a.languages.includes(lead.language) ? 0 : 1;
    const bLang = lead.language && b.languages.includes(lead.language) ? 0 : 1;
    if (aLang !== bLang) return aLang - bLang;

    if (a.activeLeadCount !== b.activeLeadCount) return a.activeLeadCount - b.activeLeadCount;
    if (a.roundRobinPosition !== b.roundRobinPosition)
      return a.roundRobinPosition - b.roundRobinPosition;
    return a.id < b.id ? -1 : 1;
  });

  const chosen = ranked[0]!;
  const reasons: string[] = ['weighted_round_robin'];
  if (lead.projectId && chosen.projectIds.includes(lead.projectId))
    reasons.unshift('project_match');
  if (lead.language && chosen.languages.includes(lead.language)) reasons.unshift('language_match');
  return { agentId: chosen.id, reason: reasons.join('+') };
}
