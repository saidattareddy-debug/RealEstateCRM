'use server';

import { revalidatePath } from 'next/cache';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { evaluateEligibility, eligibilityReasonLabel } from '@re/domain';
import { recomputeSla } from './sla';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

/**
 * Assign / reassign / unassign a conversation (Phase 4.1, Priority 4). Writes a
 * fresh `conversation_assignments` row (closing the prior active one) and a
 * transfer event, and is blocked when ownership is locked (unless unlocking).
 */
export async function assignConversationAction(
  conversationId: string,
  agentId: string | null,
  reason?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.assign')) {
    return { error: 'You do not have permission to assign conversations.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select('assigned_agent_id, owner_locked')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };
  if (conv.owner_locked) return { error: 'Ownership is locked. Unlock it before reassigning.' };

  const before = (conv.assigned_agent_id as string | null) ?? null;
  const { error } = await supabase
    .from('conversations')
    .update({ assigned_agent_id: agentId })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Assignment failed.' };

  await supabase
    .from('conversation_assignments')
    .update({ active: false, ended_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('tenant_id', ctx.activeTenantId)
    .eq('active', true);
  if (agentId) {
    await supabase.from('conversation_assignments').insert({
      tenant_id: ctx.activeTenantId,
      conversation_id: conversationId,
      agent_id: agentId,
      source: 'manual',
      assigned_by: ctx.userId,
      reason: reason ?? null,
      active: true,
    });
  }
  await supabase.from('conversation_transfer_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    from_agent_id: before,
    to_agent_id: agentId,
    source: 'manual',
    reason: reason ?? null,
    initiated_by: ctx.userId,
  });
  await writeAudit({
    action: 'CONVERSATION_ASSIGN',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    previousValues: { assigned_agent_id: before },
    newValues: { assigned_agent_id: agentId },
  });
  await recomputeSla(conversationId, { reason: 'assignment' });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath('/inbox');
  return { ok: true };
}

export async function setOwnerLockAction(
  conversationId: string,
  locked: boolean,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.assign')) {
    return { error: 'You do not have permission.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversations')
    .update({ owner_locked: locked })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not change the lock.' };
  await writeAudit({
    action: 'CONVERSATION_ASSIGN',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { owner_locked: locked },
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

/** Assign / move a conversation to a team (null = unassign team). */
export async function assignTeamAction(
  conversationId: string,
  teamId: string | null,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.assign')) {
    return { error: 'You do not have permission to assign conversations.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select('owner_locked, assigned_team_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };
  if (conv.owner_locked) return { error: 'Ownership is locked. Unlock it before reassigning.' };

  const { error } = await supabase
    .from('conversations')
    .update({ assigned_team_id: teamId })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Team assignment failed.' };
  await writeAudit({
    action: 'CONVERSATION_ASSIGN',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    previousValues: { assigned_team_id: (conv.assigned_team_id as string | null) ?? null },
    newValues: { assigned_team_id: teamId },
  });
  await recomputeSla(conversationId, { reason: 'assignment' });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export interface AgentEligibility {
  agentId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
}

/**
 * Evaluate every candidate agent's assignment eligibility for a conversation
 * (Phase 4.1, Priority 4). Pure decision is `evaluateEligibility`; this action
 * only gathers the observable signals (membership status/availability/absence,
 * team, language, workload) under RLS. Managers see exclusion reasons; the UI
 * offers only eligible agents.
 */
export async function listAgentEligibilityAction(
  conversationId: string,
): Promise<AgentEligibility[]> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.assign')) return [];
  const supabase = await createSupabaseServerClient();

  const { data: conv } = await supabase
    .from('conversations')
    .select('language, owner_locked, assigned_team_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return [];

  const [{ data: members }, { data: teamRows }, { data: openConvs }] = await Promise.all([
    supabase
      .from('memberships')
      .select(
        'profile_id, status, availability, absent_from, absent_until, max_active_conversations, languages, profiles(full_name), roles!inner(slug)',
      )
      .eq('roles.slug', 'sales_agent'),
    supabase.from('team_members').select('profile_id, team_id'),
    supabase
      .from('conversations')
      .select('assigned_agent_id')
      .neq('status', 'closed')
      .not('assigned_agent_id', 'is', null),
  ]);

  const teamsByAgent = new Map<string, string[]>();
  for (const t of teamRows ?? []) {
    const k = t.profile_id as string;
    teamsByAgent.set(k, [...(teamsByAgent.get(k) ?? []), t.team_id as string]);
  }
  const loadByAgent = new Map<string, number>();
  for (const c of openConvs ?? []) {
    const k = c.assigned_agent_id as string;
    loadByAgent.set(k, (loadByAgent.get(k) ?? 0) + 1);
  }

  const now = new Date();
  return (members ?? []).map((m) => {
    const agentId = m.profile_id as string;
    const result = evaluateEligibility(
      {
        agentId,
        membershipStatus: (m.status as 'active' | 'suspended' | 'invited') ?? 'active',
        availability: (m.availability as 'available' | 'busy' | 'away') ?? 'available',
        absentFrom: (m.absent_from as string | null) ?? null,
        absentUntil: (m.absent_until as string | null) ?? null,
        teamIds: teamsByAgent.get(agentId) ?? [],
        authorizedProjectIds: [],
        languages: (m.languages as string[] | null) ?? [],
        activeConversationCount: loadByAgent.get(agentId) ?? 0,
        maxActiveConversations: (m.max_active_conversations as number | null) ?? 0,
      },
      {
        requiredTeamId: (conv.assigned_team_id as string | null) ?? null,
        language: (conv.language as string | null) ?? null,
        ownershipLocked: Boolean(conv.owner_locked),
        now,
      },
    );
    return {
      agentId,
      name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? 'Agent',
      eligible: result.eligible,
      reasons: result.reasons.map(eligibilityReasonLabel),
    };
  });
}

/**
 * Resolve a conversation-vs-lead owner mismatch. The manager explicitly chooses
 * the direction; a reason is required; nothing is synchronised silently.
 */
export async function resolveOwnerMismatchAction(
  conversationId: string,
  choice: 'conversation_from_lead' | 'lead_from_conversation' | 'leave',
  reason: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.assign')) {
    return { error: 'You do not have permission to resolve ownership.' };
  }
  if (!reason.trim()) return { error: 'A reason is required.' };

  const supabase = await createSupabaseServerClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select('assigned_agent_id, lead_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };
  const leadId = conv.lead_id as string | null;
  const { data: la } = leadId
    ? await supabase
        .from('lead_assignments')
        .select('agent_id')
        .eq('lead_id', leadId)
        .eq('active', true)
        .maybeSingle()
    : { data: null };
  const leadOwner = (la?.agent_id as string | null) ?? null;
  const convOwner = (conv.assigned_agent_id as string | null) ?? null;

  if (choice === 'conversation_from_lead' && leadOwner) {
    await assignConversationAction(conversationId, leadOwner, `owner-sync: ${reason}`);
  } else if (choice === 'lead_from_conversation' && convOwner && leadId) {
    await supabase
      .from('lead_assignments')
      .update({ active: false })
      .eq('lead_id', leadId)
      .eq('active', true);
    await supabase.from('lead_assignments').insert({
      tenant_id: ctx.activeTenantId,
      lead_id: leadId,
      agent_id: convOwner,
      is_manual: true,
      active: true,
      assigned_by: ctx.userId,
      reason: `owner-sync: ${reason}`,
    });
  }
  await writeAudit({
    action: 'CONVERSATION_ASSIGN',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { ownerMismatchChoice: choice, reason },
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}
