'use server';

import { revalidatePath } from 'next/cache';
import {
  sendMessageSchema,
  takeoverSchema,
  transferSchema,
  closeConversationSchema,
  consentSchema,
} from '@re/validation';
import { recomputeSla } from './sla';
import {
  buildDeterministicSummary,
  isContactable,
  type ConvMessage,
  type ConsentRecord,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
  summary?: string;
}

/** Channel → consent channel mapping for DNC checks. */
const CONSENT_CHANNEL: Record<string, 'whatsapp' | 'email' | 'sms' | 'call'> = {
  whatsapp: 'whatsapp',
  email: 'email',
  website_chat: 'sms', // closest existing bucket; website replies still respect DNC
  voice: 'call',
};

export async function sendReplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.reply')) {
    return { error: 'You do not have permission to reply.' };
  }
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get('conversationId'),
    body: formData.get('body'),
    language: formData.get('language') || null,
  });
  if (!parsed.success) return { error: 'Enter a message.' };

  const supabase = await createSupabaseServerClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, lead_id, channel, status')
    .eq('id', parsed.data.conversationId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };
  if (conv.status === 'closed') return { error: 'Conversation is closed.' };

  // Enforce do-not-contact / revoked consent before any outbound message.
  const channel = String(conv.channel);
  const consentChannel = CONSENT_CHANNEL[channel] ?? 'sms';
  if (conv.lead_id) {
    const { data: consents } = await supabase
      .from('contact_consents')
      .select('channel, status')
      .eq('lead_id', conv.lead_id);
    const decision = isContactable((consents ?? []) as ConsentRecord[], consentChannel);
    if (!decision.contactable) {
      return { error: `Cannot send: ${decision.reason}` };
    }
  }

  const { error } = await supabase.from('conversation_messages').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conv.id,
    lead_id: conv.lead_id,
    direction: 'outbound',
    sender: 'agent',
    sender_id: ctx.userId,
    body: parsed.data.body,
    language: parsed.data.language ?? null,
    status: 'sent',
  });
  if (error) return { error: 'Could not send the message.' };

  const now = new Date().toISOString();
  await supabase
    .from('conversations')
    .update({ last_message_at: now, needs_response: false })
    .eq('id', conv.id)
    .eq('tenant_id', ctx.activeTenantId);

  await writeAudit({
    action: 'CONVERSATION_REPLY',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conv.id as string,
  });
  await recomputeSla(conv.id as string, { reason: 'outbound_message' });
  revalidatePath(`/inbox/${conv.id}`);
  revalidatePath('/inbox');
  return { ok: true };
}

export async function takeOverAction(
  conversationId: string,
  reason?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.takeover')) {
    return { error: 'You do not have permission to take over.' };
  }
  const parsed = takeoverSchema.safeParse({ conversationId, reason: reason ?? null });
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversations')
    .update({
      ai_active: false,
      operating_mode: 'human',
      human_takeover_by: ctx.userId,
      human_takeover_at: new Date().toISOString(),
      assigned_agent_id: ctx.userId,
    })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Takeover failed.' };

  await supabase.from('conversation_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    type: 'takeover',
    actor_id: ctx.userId,
    to_agent_id: ctx.userId,
    reason: parsed.data.reason ?? null,
  });
  await writeAudit({
    action: 'CONVERSATION_TAKEOVER',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

/**
 * End a human takeover. This NEVER activates AI — it can only move the
 * conversation to a non-AI mode (paused), leaving `ai_active` false. The real
 * AI responder (Phase 5) is gated by `canExecuteAutomatedReply`, which always
 * denies until installed. See ops-actions.ts#setOperatingModeAction.
 */
export async function resumeAiAction(conversationId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.ai.resume')) {
    return { error: 'You do not have permission.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversations')
    .update({
      ai_active: false,
      operating_mode: 'paused',
      human_takeover_by: null,
      human_takeover_at: null,
    })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Update failed.' };

  await supabase.from('conversation_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    type: 'resume',
    actor_id: ctx.userId,
  });
  await writeAudit({
    action: 'CONVERSATION_RESUME',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { operating_mode: 'paused' },
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export async function transferConversationAction(
  conversationId: string,
  toAgentId: string,
  reason?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.transfer')) {
    return { error: 'You do not have permission to transfer.' };
  }
  const parsed = transferSchema.safeParse({ conversationId, toAgentId, reason: reason ?? null });
  if (!parsed.success) return { error: 'Pick an agent to transfer to.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('conversations')
    .select('assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle();
  const { error } = await supabase
    .from('conversations')
    .update({ assigned_agent_id: parsed.data.toAgentId })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Transfer failed.' };

  await supabase.from('conversation_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    type: 'transfer',
    actor_id: ctx.userId,
    from_agent_id: (before?.assigned_agent_id as string | null) ?? null,
    to_agent_id: parsed.data.toAgentId,
    reason: parsed.data.reason ?? null,
  });
  // Durable transfer history (owner change, initiator, reason).
  await supabase.from('conversation_transfer_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    from_agent_id: (before?.assigned_agent_id as string | null) ?? null,
    to_agent_id: parsed.data.toAgentId,
    source: 'manual',
    reason: parsed.data.reason ?? null,
    initiated_by: ctx.userId,
  });
  // Record the new active assignment row.
  await supabase
    .from('conversation_assignments')
    .update({ active: false, ended_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('tenant_id', ctx.activeTenantId)
    .eq('active', true);
  await supabase.from('conversation_assignments').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    agent_id: parsed.data.toAgentId,
    source: 'manual',
    assigned_by: ctx.userId,
    reason: parsed.data.reason ?? null,
    active: true,
  });
  await writeAudit({
    action: 'CONVERSATION_TRANSFER',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { toAgentId: parsed.data.toAgentId },
  });
  await recomputeSla(conversationId, { reason: 'transfer' });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export async function closeConversationAction(
  conversationId: string,
  reopen = false,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.reply')) {
    return { error: 'You do not have permission.' };
  }
  const parsed = closeConversationSchema.safeParse({ conversationId, reopen });
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversations')
    .update({ status: parsed.data.reopen ? 'open' : 'closed' })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update the conversation.' };

  await supabase.from('conversation_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    type: parsed.data.reopen ? 'reopen' : 'close',
    actor_id: ctx.userId,
  });
  await writeAudit({
    action: 'CONVERSATION_CLOSE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { reopen: parsed.data.reopen },
  });
  await recomputeSla(conversationId, {
    reason: parsed.data.reopen ? 'reopen' : 'close',
  });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath('/inbox');
  return { ok: true };
}

/** Generate a deterministic (non-AI) summary from the message log. */
export async function generateSummaryAction(conversationId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.reply')) {
    return { error: 'You do not have permission.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data: messages } = await supabase
    .from('conversation_messages')
    .select('direction, sender, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  const summary = buildDeterministicSummary(
    (messages ?? []).map((m) => ({
      direction: m.direction as ConvMessage['direction'],
      sender: m.sender as ConvMessage['sender'],
      body: (m.body as string | null) ?? null,
      createdAt: m.created_at as string,
    })),
  );

  const { data: inserted, error } = await supabase
    .from('conversation_summaries')
    .insert({
      tenant_id: ctx.activeTenantId,
      conversation_id: conversationId,
      summary: summary.summary,
      unanswered_question: summary.unansweredQuestion,
      recommended_next_action: summary.recommendedNextAction,
      message_count: summary.messageCount,
      source: 'deterministic',
      generated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error) return { error: 'Could not generate a summary.' };

  // Append a version (manual/deterministic only — AI summaries are Phase 5 and
  // are rejected by the DB CHECK; model/prompt stay null).
  const { count } = await supabase
    .from('conversation_summary_versions')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  await supabase
    .from('conversation_summary_versions')
    .update({ superseded_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .is('superseded_at', null);
  await supabase.from('conversation_summary_versions').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    summary_id: inserted?.id ?? null,
    version: (count ?? 0) + 1,
    summary_type: 'system_digest',
    body: summary.summary,
    created_by: ctx.userId,
  });

  await writeAudit({
    action: 'CONVERSATION_SUMMARY',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { source: 'deterministic' },
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export async function updateConsentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.update')) {
    return { error: 'You do not have permission to update consent.' };
  }
  const parsed = consentSchema.safeParse({
    leadId: formData.get('leadId') || null,
    channel: formData.get('channel') || 'any',
    status: formData.get('status'),
    note: formData.get('note') || null,
  });
  if (!parsed.success) return { error: 'Invalid consent update.' };

  const supabase = await createSupabaseServerClient();
  // Manual upsert: the uniqueness index is expression-based (coalesces nulls),
  // so we cannot use onConflict by column name.
  const contactValue = parsed.data.contactValue ?? null;
  let existing = supabase
    .from('contact_consents')
    .select('id')
    .eq('tenant_id', ctx.activeTenantId)
    .eq('channel', parsed.data.channel);
  existing = parsed.data.leadId
    ? existing.eq('lead_id', parsed.data.leadId)
    : existing.is('lead_id', null);
  existing = contactValue
    ? existing.eq('contact_value', contactValue)
    : existing.is('contact_value', null);
  const { data: found } = await existing.maybeSingle();

  const row = {
    tenant_id: ctx.activeTenantId,
    lead_id: parsed.data.leadId ?? null,
    channel: parsed.data.channel,
    contact_value: contactValue,
    status: parsed.data.status,
    note: parsed.data.note ?? null,
    updated_by: ctx.userId,
  };
  const { error } = found
    ? await supabase
        .from('contact_consents')
        .update(row)
        .eq('id', found.id as string)
    : await supabase.from('contact_consents').insert(row);
  if (error) return { error: 'Could not update consent.' };

  await writeAudit({
    action: 'CONSENT_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: (parsed.data.leadId as string | null) ?? null,
    newValues: { channel: parsed.data.channel, status: parsed.data.status },
  });
  if (parsed.data.leadId) revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
