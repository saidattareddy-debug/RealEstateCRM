'use server';

import { revalidatePath } from 'next/cache';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export interface InboxView {
  id: string;
  name: string;
  scope: 'private' | 'team' | 'tenant';
  ownerId: string;
  isDefault: boolean;
  section: string | null;
  density: string;
  filters: Record<string, unknown>;
}

const SCOPES = new Set(['private', 'team', 'tenant']);

/**
 * Inbox saved views reuse the existing `saved_views` system (entity =
 * 'conversations') and its permission model — no parallel access model. A view
 * stores ONLY filters/section/density/sort; it can never widen conversation RLS,
 * because the inbox list query always runs under the viewer's own RLS first and
 * the saved-view filters only narrow the already-visible set.
 */
export async function listInboxViews(): Promise<InboxView[]> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.read.assigned')) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('saved_views')
    .select('id, name, scope, owner_id, is_default, section, density, filters')
    .eq('entity', 'conversations')
    .order('name', { ascending: true });
  return (data ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
    scope: (v.scope as 'private' | 'team' | 'tenant') ?? 'private',
    ownerId: v.owner_id as string,
    isDefault: Boolean(v.is_default),
    section: (v.section as string | null) ?? null,
    density: (v.density as string | null) ?? 'comfortable',
    filters: (v.filters as Record<string, unknown> | null) ?? {},
  }));
}

export async function createInboxView(input: {
  name: string;
  scope: string;
  filter?: string;
  tag?: string;
  section?: string;
  density?: string;
}): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.read.assigned')) {
    return { error: 'You do not have permission.' };
  }
  const name = input.name.trim();
  if (!name) return { error: 'A name is required.' };
  const scope = SCOPES.has(input.scope) ? input.scope : 'private';
  const density = input.density === 'compact' ? 'compact' : 'comfortable';

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('saved_views').insert({
    tenant_id: ctx.activeTenantId,
    owner_id: ctx.userId,
    entity: 'conversations',
    name,
    scope,
    section: input.section ?? input.filter ?? 'all',
    density,
    filters: { filter: input.filter ?? 'all', tag: input.tag ?? null },
  });
  if (error) return { error: 'Could not save the view.' };
  revalidatePath('/inbox');
  return { ok: true };
}

export async function deleteInboxView(id: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No tenant.' };
  const supabase = await createSupabaseServerClient();
  // RLS write policy restricts deletion to the owner.
  const { error } = await supabase.from('saved_views').delete().eq('id', id);
  if (error) return { error: 'Could not delete (you can only delete your own views).' };
  revalidatePath('/inbox');
  return { ok: true };
}

export async function setDefaultInboxView(id: string, isDefault: boolean): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No tenant.' };
  const supabase = await createSupabaseServerClient();
  if (isDefault) {
    // Personal default: clear my other conversation-view defaults first.
    await supabase
      .from('saved_views')
      .update({ is_default: false })
      .eq('entity', 'conversations')
      .eq('owner_id', ctx.userId);
  }
  const { error } = await supabase
    .from('saved_views')
    .update({ is_default: isDefault })
    .eq('id', id)
    .eq('owner_id', ctx.userId);
  if (error) return { error: 'Could not update the default.' };
  revalidatePath('/inbox');
  return { ok: true };
}
