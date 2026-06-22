'use server';

import { revalidatePath } from 'next/cache';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

/** Allow-list of colour tokens a tag may use (docs/UI_SYSTEM.md palette). */
const COLOUR_TOKENS = ['forest', 'terracotta', 'warning', 'success', 'muted'] as const;
type ColourToken = (typeof COLOUR_TOKENS)[number];

function isColourToken(value: string): value is ColourToken {
  return (COLOUR_TOKENS as readonly string[]).includes(value);
}

function cleanName(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 60 ? trimmed : null;
}

export interface ConversationTag {
  id: string;
  name: string;
  color_token: string;
  active: boolean;
}

/**
 * RLS-scoped list of conversation tags for the active tenant. By default only
 * active (assignable) tags are returned; management views pass
 * `includeInactive` to surface disabled tags too.
 */
export async function listTags(opts?: { includeInactive?: boolean }): Promise<ConversationTag[]> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return [];

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('conversation_tags')
    .select('id, name, color_token, active')
    .eq('tenant_id', ctx.activeTenantId)
    .order('name', { ascending: true });
  if (!opts?.includeInactive) query = query.eq('active', true);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as ConversationTag[];
}

export async function createTag(name: string, colorToken: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Enter a tag name.' };
  if (!isColourToken(colorToken)) return { error: 'Invalid colour.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('conversation_tags')
    .insert({
      tenant_id: ctx.activeTenantId,
      name: cleaned,
      color_token: colorToken,
      active: true,
      created_by: ctx.userId,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    return { error: 'Could not create tag (the name may already be in use).' };
  }

  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation_tag',
    entityId: (data?.id as string | undefined) ?? null,
    newValues: { name: cleaned, color_token: colorToken, active: true },
  });
  revalidatePath('/settings/tags');
  return { ok: true };
}

export async function renameTag(id: string, name: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Enter a tag name.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversation_tags')
    .update({ name: cleaned })
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) {
    return { error: 'Could not rename tag (the name may already be in use).' };
  }

  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation_tag',
    entityId: id,
    newValues: { name: cleaned },
  });
  revalidatePath('/settings/tags');
  return { ok: true };
}

export async function setTagColor(id: string, colorToken: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }
  if (!isColourToken(colorToken)) return { error: 'Invalid colour.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversation_tags')
    .update({ color_token: colorToken })
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update colour.' };

  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation_tag',
    entityId: id,
    newValues: { color_token: colorToken },
  });
  revalidatePath('/settings/tags');
  return { ok: true };
}

export async function setTagActive(id: string, active: boolean): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('conversation_tags')
    .update({ active })
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update tag.' };

  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation_tag',
    entityId: id,
    newValues: { active },
  });
  revalidatePath('/settings/tags');
  return { ok: true };
}

/**
 * Attach or detach a single tag across many conversations at once. Disabled
 * (inactive) tags may remain on historical conversations but can never be
 * NEWLY assigned, so attaching an inactive tag is rejected. RLS naturally
 * restricts writes to conversations the actor can see.
 */
export async function bulkTagConversations(
  conversationIds: string[],
  tagId: string,
  attach: boolean,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.tags.manage')) {
    return { error: 'You do not have permission to manage tags.' };
  }
  if (!tagId) return { error: 'Select a tag.' };
  const ids = Array.from(new Set(conversationIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return { error: 'Select at least one conversation.' };

  const supabase = await createSupabaseServerClient();

  if (attach) {
    // Verify the tag exists, belongs to the tenant, and is still assignable.
    const { data: tag } = await supabase
      .from('conversation_tags')
      .select('id, active')
      .eq('id', tagId)
      .eq('tenant_id', ctx.activeTenantId)
      .maybeSingle();
    if (!tag) return { error: 'Tag not found.' };
    if (tag.active === false) {
      return { error: 'Tag is disabled and cannot be newly assigned.' };
    }

    const rows = ids.map((conversationId) => ({
      tenant_id: ctx.activeTenantId!,
      conversation_id: conversationId,
      tag_id: tagId,
      assigned_by: ctx.userId,
    }));
    const { error } = await supabase
      .from('conversation_tag_assignments')
      .upsert(rows, { onConflict: 'conversation_id,tag_id' });
    if (error) return { error: 'Could not assign tag.' };
  } else {
    const { error } = await supabase
      .from('conversation_tag_assignments')
      .delete()
      .eq('tag_id', tagId)
      .in('conversation_id', ids);
    if (error) return { error: 'Could not remove tag.' };
  }

  await writeAudit({
    action: 'CONVERSATION_TAG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'conversation_tag',
    entityId: tagId,
    newValues: { attach, count: ids.length },
  });
  revalidatePath('/inbox');
  return { ok: true };
}
