'use server';

import { revalidatePath } from 'next/cache';
import { resolveCannedReply, type CannedVariable } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { sendReplyAction } from './actions';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

const CHANNELS = ['website_chat', 'whatsapp', 'email', 'voice'] as const;
type Channel = (typeof CHANNELS)[number];

export interface ComposerCannedReply {
  id: string;
  title: string;
  body: string;
  language: string | null;
  channel: Channel | null;
}

/**
 * List active canned replies the agent may use in the composer. RLS scopes the
 * rows to the tenant; we additionally narrow to the conversation's channel
 * (channel-agnostic replies — `channel is null` — always qualify).
 */
export async function listCannedRepliesForComposer(
  conversationId: string,
): Promise<ComposerCannedReply[]> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.reply')) {
    return [];
  }
  const supabase = await createSupabaseServerClient();

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, channel')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return [];

  // RLS already restricts to this tenant; only active replies are usable.
  const { data: rows } = await supabase
    .from('canned_replies')
    .select('id, title, body, language, channel')
    .eq('active', true)
    .order('title', { ascending: true });

  const convChannel = conv.channel as Channel | null;
  return (rows ?? [])
    .filter((r) => {
      const c = (r.channel as Channel | null) ?? null;
      return c === null || c === convChannel;
    })
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      body: r.body as string,
      language: (r.language as string | null) ?? null,
      channel: (r.channel as Channel | null) ?? null,
    }));
}

/**
 * Resolve a canned reply on the SERVER and send it through `sendReplyAction`,
 * which enforces reply permission, conversation status, consent, DNC and the
 * operating-mode/takeover rules. The resolved text never leaves the server in
 * any audit/metadata payload; only the canned-reply id is recorded.
 */
export async function sendCannedReply(
  conversationId: string,
  cannedReplyId: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.reply')) {
    return { error: 'You do not have permission to reply.' };
  }
  const supabase = await createSupabaseServerClient();

  const { data: reply } = await supabase
    .from('canned_replies')
    .select('id, body, language, project_id, active')
    .eq('id', cannedReplyId)
    .maybeSingle();
  if (!reply || !reply.active) return { error: 'Canned reply not found.' };

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, lead_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };

  // Build the allowed values object on the server. Only fields that exist are
  // mapped; unmapped-but-allowed tokens are left blank by the resolver.
  const values: Partial<Record<CannedVariable, string>> = {};

  if (conv.lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('full_name, primary_phone_national')
      .eq('id', conv.lead_id as string)
      .maybeSingle();
    if (lead?.full_name) values.lead_name = lead.full_name as string;
    if (lead?.primary_phone_national) values.contact_number = lead.primary_phone_national as string;
  }

  // Acting agent's display name.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', ctx.userId)
    .maybeSingle();
  if (profile?.full_name) values.agent_name = profile.full_name as string;

  // Project facts come from the canned reply's linked project (conversations
  // do not carry a project_id).
  if (reply.project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('name, locality, address')
      .eq('id', reply.project_id as string)
      .maybeSingle();
    if (project?.name) values.project_name = project.name as string;
    if (project?.locality) values.project_location = project.locality as string;
    if (project?.address) values.site_address = project.address as string;
  }

  const resolved = resolveCannedReply(reply.body as string, values);
  if (!resolved.ok || resolved.text == null) {
    return { error: resolved.error ?? 'Could not resolve the canned reply.' };
  }

  // Delegate sending so every send-time guard is enforced in one place.
  const fd = new FormData();
  fd.set('conversationId', conversationId);
  fd.set('body', resolved.text);
  if (reply.language) fd.set('language', reply.language as string);
  const sendResult = await sendReplyAction({}, fd);
  if (!sendResult.ok) return { error: sendResult.error ?? 'Could not send the reply.' };

  // Record WHICH reply was used (never the resolved body) and bump the counter.
  await supabase.from('canned_reply_usage_events').insert({
    tenant_id: ctx.activeTenantId,
    canned_reply_id: cannedReplyId,
    conversation_id: conversationId,
    used_by: ctx.userId,
  });
  const { data: current } = await supabase
    .from('canned_replies')
    .select('usage_count')
    .eq('id', cannedReplyId)
    .maybeSingle();
  await supabase
    .from('canned_replies')
    .update({ usage_count: ((current?.usage_count as number | null) ?? 0) + 1 })
    .eq('id', cannedReplyId)
    .eq('tenant_id', ctx.activeTenantId);

  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

interface CannedReplyInput {
  title: string;
  body: string;
  categoryId?: string | null;
  language?: string | null;
  projectId?: string | null;
  channel?: string | null;
}

function normaliseChannel(value: string | null | undefined): Channel | null {
  if (!value) return null;
  return (CHANNELS as readonly string[]).includes(value) ? (value as Channel) : null;
}

/** Validate the template at save time: reject any unknown `{{var}}` tokens. */
function validateTemplate(body: string): string | null {
  const result = resolveCannedReply(body, {});
  if (!result.ok) {
    return `Unknown variable(s): ${result.unknownVariables.join(', ')}`;
  }
  return null;
}

export async function createCannedReply(input: CannedReplyInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'canned_replies.manage')) {
    return { error: 'You do not have permission to manage canned replies.' };
  }
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (!title) return { error: 'Enter a title.' };
  if (!body) return { error: 'Enter a body.' };

  const templateError = validateTemplate(body);
  if (templateError) return { error: templateError };

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from('canned_replies')
    .insert({
      tenant_id: ctx.activeTenantId,
      category_id: input.categoryId || null,
      title,
      body,
      language: input.language?.trim() || null,
      project_id: input.projectId || null,
      channel: normaliseChannel(input.channel),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error) return { error: 'Could not create the canned reply.' };

  await writeAudit({
    action: 'CANNED_REPLY_MANAGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'canned_reply',
    entityId: (inserted?.id as string | null) ?? null,
    newValues: { title, categoryId: input.categoryId ?? null, op: 'create' },
  });
  revalidatePath('/settings/canned-replies');
  return { ok: true };
}

export async function updateCannedReply(id: string, input: CannedReplyInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'canned_replies.manage')) {
    return { error: 'You do not have permission to manage canned replies.' };
  }
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (!title) return { error: 'Enter a title.' };
  if (!body) return { error: 'Enter a body.' };

  const templateError = validateTemplate(body);
  if (templateError) return { error: templateError };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('canned_replies')
    .update({
      category_id: input.categoryId || null,
      title,
      body,
      language: input.language?.trim() || null,
      project_id: input.projectId || null,
      channel: normaliseChannel(input.channel),
      updated_by: ctx.userId,
    })
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update the canned reply.' };

  await writeAudit({
    action: 'CANNED_REPLY_MANAGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'canned_reply',
    entityId: id,
    newValues: { title, categoryId: input.categoryId ?? null, op: 'update' },
  });
  revalidatePath('/settings/canned-replies');
  return { ok: true };
}

export async function setCannedReplyActive(id: string, active: boolean): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'canned_replies.manage')) {
    return { error: 'You do not have permission to manage canned replies.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('canned_replies')
    .update({ active, updated_by: ctx.userId })
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update the canned reply.' };

  await writeAudit({
    action: 'CANNED_REPLY_MANAGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'canned_reply',
    entityId: id,
    newValues: { active, op: active ? 'enable' : 'disable' },
  });
  revalidatePath('/settings/canned-replies');
  return { ok: true };
}
