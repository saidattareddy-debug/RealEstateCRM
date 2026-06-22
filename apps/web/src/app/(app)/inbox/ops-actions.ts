'use server';

import { revalidatePath } from 'next/cache';
import {
  setModeSchema,
  changeStatusSchema,
  changePrioritySchema,
  noteSchema,
  tagSchema,
  markReadSchema,
  redactSchema,
  dncEntrySchema,
} from '@re/validation';
import { resumeTargetMode } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { sha256Hex } from '@/lib/leads/security';
import { recomputeSla } from './sla';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

/**
 * Set the conversation operating mode. The UI may ONLY choose human/paused —
 * never 'ai'. `resumeTargetMode` guarantees AI cannot be activated here, so
 * resuming from takeover can never start the (absent) AI responder.
 */
export async function setOperatingModeAction(
  conversationId: string,
  mode: 'human' | 'paused',
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.ai.resume')) {
    return { error: 'You do not have permission to change the operating mode.' };
  }
  const parsed = setModeSchema.safeParse({ conversationId, mode });
  if (!parsed.success) return { error: 'Invalid mode.' };

  const target = resumeTargetMode(parsed.data.mode); // never 'ai'
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversations')
    .update({
      operating_mode: target,
      ai_active: false, // hard guarantee: AI stays off
      human_takeover_by: target === 'human' ? ctx.userId : null,
      human_takeover_at: target === 'human' ? new Date().toISOString() : null,
    })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not change mode.' };

  await supabase.from('conversation_events').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    type: target === 'human' ? 'takeover' : 'resume',
    actor_id: ctx.userId,
  });
  await writeAudit({
    action: target === 'human' ? 'CONVERSATION_TAKEOVER' : 'CONVERSATION_RESUME',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { operating_mode: target },
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export async function changeStatusAction(
  conversationId: string,
  lifecycle: 'open' | 'paused' | 'resolved' | 'closed' | 'spam' | 'archived',
  reason?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  const needs = lifecycle === 'open' ? 'conversations.reopen' : 'conversations.close';
  if (!ctx.activeTenantId || !ensurePermission(ctx, needs)) {
    return { error: 'You do not have permission to change status.' };
  }
  const parsed = changeStatusSchema.safeParse({
    conversationId,
    lifecycle,
    reason: reason ?? null,
  });
  if (!parsed.success) return { error: 'Invalid status.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('conversations')
    .select('lifecycle')
    .eq('id', conversationId)
    .maybeSingle();

  // Keep the legacy status column coherent for existing queries.
  const status =
    lifecycle === 'closed' ||
    lifecycle === 'resolved' ||
    lifecycle === 'archived' ||
    lifecycle === 'spam'
      ? 'closed'
      : lifecycle === 'paused'
        ? 'snoozed'
        : 'open';

  const { error } = await supabase
    .from('conversations')
    .update({ lifecycle: parsed.data.lifecycle, status })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Status change failed.' };

  const correlationId = crypto.randomUUID();
  await supabase.from('conversation_status_history').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    previous_value: (before?.lifecycle as string | null) ?? null,
    new_value: parsed.data.lifecycle,
    actor_id: ctx.userId,
    reason: parsed.data.reason ?? null,
    correlation_id: correlationId,
  });
  await writeAudit({
    action: 'CONVERSATION_STATUS_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    previousValues: { lifecycle: before?.lifecycle ?? null },
    newValues: { lifecycle: parsed.data.lifecycle },
  });
  await recomputeSla(conversationId, { reason: 'status_change', correlationId });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath('/inbox');
  return { ok: true };
}

export async function changePriorityAction(
  conversationId: string,
  priority: 'low' | 'normal' | 'high' | 'urgent',
  reason?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.priority.manage')) {
    return { error: 'You do not have permission to change priority.' };
  }
  const parsed = changePrioritySchema.safeParse({
    conversationId,
    priority,
    reason: reason ?? null,
  });
  if (!parsed.success) return { error: 'Invalid priority.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('conversations')
    .select('priority')
    .eq('id', conversationId)
    .maybeSingle();
  const { error } = await supabase
    .from('conversations')
    .update({ priority: parsed.data.priority })
    .eq('id', conversationId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Priority change failed.' };

  await supabase.from('conversation_priority_history').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: conversationId,
    previous_value: (before?.priority as string | null) ?? null,
    new_value: parsed.data.priority,
    actor_id: ctx.userId,
    reason: parsed.data.reason ?? null,
    correlation_id: crypto.randomUUID(),
  });
  await writeAudit({
    action: 'CONVERSATION_PRIORITY_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: conversationId,
    newValues: { priority: parsed.data.priority },
  });
  await recomputeSla(conversationId, { reason: 'priority_change' });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

export async function addConversationNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.notes.create')) {
    return { error: 'You do not have permission to add notes.' };
  }
  const parsed = noteSchema.safeParse({
    conversationId: formData.get('conversationId'),
    body: formData.get('body'),
    visibility: formData.get('visibility') || 'team',
    pinned: formData.get('pinned') === 'on',
  });
  if (!parsed.success) return { error: 'Enter a note.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('conversation_notes').insert({
    tenant_id: ctx.activeTenantId,
    conversation_id: parsed.data.conversationId,
    author_id: ctx.userId,
    body: parsed.data.body,
    visibility: parsed.data.visibility,
    pinned: parsed.data.pinned,
  });
  if (error) return { error: 'Could not add note.' };
  await writeAudit({
    action: 'CONVERSATION_NOTE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: parsed.data.conversationId,
  });
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { ok: true };
}

export async function toggleTagAction(
  conversationId: string,
  tagId: string,
  attach: boolean,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }
  const parsed = tagSchema.safeParse({ conversationId, tagId });
  if (!parsed.success) return { error: 'Invalid tag.' };

  const supabase = await createSupabaseServerClient();
  const { error } = attach
    ? await supabase.from('conversation_tag_assignments').upsert({
        tenant_id: ctx.activeTenantId,
        conversation_id: parsed.data.conversationId,
        tag_id: parsed.data.tagId,
        assigned_by: ctx.userId,
      })
    : await supabase
        .from('conversation_tag_assignments')
        .delete()
        .eq('conversation_id', parsed.data.conversationId)
        .eq('tag_id', parsed.data.tagId);
  if (error) return { error: 'Could not update tag.' };
  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation',
    entityId: parsed.data.conversationId,
    newValues: { tagId: parsed.data.tagId, attach },
  });
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { ok: true };
}

/** Mark a conversation read for the CURRENT user only (never for everyone). */
export async function markReadAction(
  conversationId: string,
  lastReadMessageId?: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.read.assigned')) {
    return { error: 'No permission.' };
  }
  const parsed = markReadSchema.safeParse({
    conversationId,
    lastReadMessageId: lastReadMessageId ?? null,
  });
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  // RLS guarantees a user can only write their OWN read row and only on a
  // conversation they can see.
  const { error } = await supabase.from('conversation_reads').upsert(
    {
      tenant_id: ctx.activeTenantId,
      conversation_id: parsed.data.conversationId,
      profile_id: ctx.userId,
      last_read_message_id: parsed.data.lastReadMessageId ?? null,
      last_read_at: new Date().toISOString(),
      unread_count: 0,
    },
    { onConflict: 'conversation_id,profile_id' },
  );
  if (error) return { error: 'Could not mark read.' };
  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * Redact a message. Removes the original content from the rendered row and
 * records a redaction event with only a HASH of the original (never the
 * original text) so it cannot leak via the audit log.
 */
export async function redactMessageAction(messageId: string, reason: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'messages.redact')) {
    return { error: 'You do not have permission to redact messages.' };
  }
  const parsed = redactSchema.safeParse({ messageId, reason });
  if (!parsed.success) return { error: 'A reason is required.' };

  // Read the message under RLS to confirm visibility + capture content.
  const supabase = await createSupabaseServerClient();
  const { data: msg } = await supabase
    .from('conversation_messages')
    .select('id, conversation_id, body, redacted')
    .eq('id', parsed.data.messageId)
    .maybeSingle();
  if (!msg) return { error: 'Message not found.' };
  if (msg.redacted) return { ok: true };

  const originalHash = sha256Hex(String(msg.body ?? ''));
  const admin = createSupabaseAdminClient();
  await admin
    .from('conversation_messages')
    .update({ body: '[redacted]', redacted: true, redacted_at: new Date().toISOString() })
    .eq('id', parsed.data.messageId);
  await admin.from('message_redaction_events').insert({
    tenant_id: ctx.activeTenantId,
    message_id: parsed.data.messageId,
    conversation_id: msg.conversation_id,
    reason: parsed.data.reason,
    actor_id: ctx.userId,
    original_hash: originalHash,
    replacement_text: '[redacted]',
  });
  await writeAudit({
    action: 'MESSAGE_REDACT',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'message',
    entityId: parsed.data.messageId,
    newValues: { reason: parsed.data.reason }, // never the original content
  });
  revalidatePath(`/inbox/${msg.conversation_id}`);
  return { ok: true };
}

export async function addDncEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'dnc.manage')) {
    return { error: 'You do not have permission to manage do-not-contact.' };
  }
  const parsed = dncEntrySchema.safeParse({
    leadId: formData.get('leadId') || null,
    contactValue: formData.get('contactValue') || null,
    channel: formData.get('channel') || 'any',
    reason: formData.get('reason') || 'user_opt_out',
    note: formData.get('note') || null,
  });
  if (!parsed.success) return { error: 'Invalid DNC entry.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('do_not_contact_entries').insert({
    tenant_id: ctx.activeTenantId,
    lead_id: parsed.data.leadId ?? null,
    contact_value: parsed.data.contactValue ?? null,
    channel: parsed.data.channel,
    scope: parsed.data.leadId ? 'lead' : 'contact_value',
    reason: parsed.data.reason,
    resolution: parsed.data.note ?? null,
    active: true,
    activated_by: ctx.userId,
  });
  if (error) return { error: 'Could not add DNC entry.' };
  // Record the consent-lifecycle event (a DNC activation withdraws contact consent).
  if (ensurePermission(ctx, 'consent.manage')) {
    await supabase.from('consent_events').insert({
      tenant_id: ctx.activeTenantId,
      lead_id: parsed.data.leadId ?? null,
      type: 'contact_consent_withdrawn',
      channel: parsed.data.channel,
      actor_id: ctx.userId,
      note: parsed.data.note ?? null,
    });
  }
  await writeAudit({
    action: 'DNC_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: (parsed.data.leadId as string | null) ?? null,
    newValues: { channel: parsed.data.channel, reason: parsed.data.reason, active: true },
  });
  if (parsed.data.leadId) revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
