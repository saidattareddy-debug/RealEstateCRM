/**
 * Deterministic agent-assignment eligibility (Phase 4.1). Pure: given a
 * candidate agent's signals and the conversation context, decide whether the
 * agent may be offered for assignment and, if not, why. Managers see the
 * exclusion reasons; the UI only lists agents whose `eligible` is true.
 *
 * No availability/workload heuristics are invented at the call site — every
 * input is an explicit, observable signal (membership status, availability,
 * absence window, team, project authorisation, language, active-conversation
 * count vs cap, ownership lock).
 */

export type EligibilityReason =
  | 'inactive_membership'
  | 'unavailable'
  | 'absent'
  | 'not_in_team'
  | 'not_project_authorized'
  | 'language_mismatch'
  | 'at_workload_cap'
  | 'ownership_locked';

export interface AgentSignals {
  agentId: string;
  membershipStatus: 'active' | 'suspended' | 'invited';
  availability: 'available' | 'busy' | 'away';
  absentFrom: string | null;
  absentUntil: string | null;
  /** Teams the agent belongs to. */
  teamIds: readonly string[];
  /** Projects the agent is authorised for; empty = authorised for all. */
  authorizedProjectIds: readonly string[];
  /** Languages the agent handles; empty = any language. */
  languages: readonly string[];
  /** Open/active conversations currently owned by the agent. */
  activeConversationCount: number;
  /** Per-agent cap; 0 = uncapped. */
  maxActiveConversations: number;
}

export interface AssignmentContext {
  /** Required team for a team-scoped assignment, if any. */
  requiredTeamId?: string | null;
  /** Conversation's project, if any. */
  projectId?: string | null;
  /** Conversation language, if known. */
  language?: string | null;
  /** Whether the conversation's ownership is locked. */
  ownershipLocked?: boolean;
  /** Evaluation instant (for absence windows). */
  now: Date;
}

export interface EligibilityResult {
  agentId: string;
  eligible: boolean;
  reasons: EligibilityReason[];
}

function isAbsent(s: AgentSignals, now: Date): boolean {
  if (!s.absentFrom && !s.absentUntil) return false;
  const from = s.absentFrom ? new Date(s.absentFrom).getTime() : -Infinity;
  const until = s.absentUntil ? new Date(s.absentUntil).getTime() : Infinity;
  const t = now.getTime();
  return t >= from && t <= until;
}

export function evaluateEligibility(
  agent: AgentSignals,
  ctx: AssignmentContext,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  if (agent.membershipStatus !== 'active') reasons.push('inactive_membership');
  if (agent.availability === 'away') reasons.push('unavailable');
  if (isAbsent(agent, ctx.now)) reasons.push('absent');

  if (ctx.requiredTeamId && !agent.teamIds.includes(ctx.requiredTeamId)) {
    reasons.push('not_in_team');
  }
  if (
    ctx.projectId &&
    agent.authorizedProjectIds.length > 0 &&
    !agent.authorizedProjectIds.includes(ctx.projectId)
  ) {
    reasons.push('not_project_authorized');
  }
  if (ctx.language && agent.languages.length > 0 && !agent.languages.includes(ctx.language)) {
    reasons.push('language_mismatch');
  }
  if (
    agent.maxActiveConversations > 0 &&
    agent.activeConversationCount >= agent.maxActiveConversations
  ) {
    reasons.push('at_workload_cap');
  }
  if (ctx.ownershipLocked) reasons.push('ownership_locked');

  return { agentId: agent.agentId, eligible: reasons.length === 0, reasons };
}

const REASON_LABELS: Record<EligibilityReason, string> = {
  inactive_membership: 'Membership not active',
  unavailable: 'Marked away',
  absent: 'On temporary absence',
  not_in_team: 'Not in the required team',
  not_project_authorized: 'Not authorised for this project',
  language_mismatch: 'Does not handle this language',
  at_workload_cap: 'At active-conversation cap',
  ownership_locked: 'Ownership is locked',
};

export function eligibilityReasonLabel(reason: EligibilityReason): string {
  return REASON_LABELS[reason];
}
