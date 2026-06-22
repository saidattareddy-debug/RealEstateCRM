'use server';

import { buildSnippet } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SearchHit {
  conversationId: string;
  leadName: string | null;
  channel: string;
  snippet: { text: string; matchStart: number; matchEnd: number } | null;
}

/**
 * Permission-safe conversation search (Phase 4.1, Priority 7).
 *
 * Security order: the queries below run under the caller's RLS session, so they
 * only ever touch conversations/messages the user may see — there is no global
 * search-then-filter. Redacted message bodies are excluded. Snippets are plain
 * text (no markup). Results are capped/paginated.
 */
export async function searchInbox(query: string, limit = 20): Promise<SearchHit[]> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.read.assigned')) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const supabase = await createSupabaseServerClient();

  // 1) Message-content hits (redacted bodies excluded). RLS-scoped.
  const { data: msgs } = await supabase
    .from('conversation_messages')
    .select('conversation_id, body')
    .eq('redacted', false)
    .ilike('body', like)
    .limit(limit);

  // 2) Lead identity hits → their conversations. RLS-scoped on both tables.
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name')
    .or(`full_name.ilike.${like},primary_phone_national.ilike.${like},primary_email.ilike.${like}`)
    .limit(limit);
  const leadIds = (leads ?? []).map((l) => l.id as string);

  const byConv = new Map<string, SearchHit>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    if (!byConv.has(cid)) {
      byConv.set(cid, {
        conversationId: cid,
        leadName: null,
        channel: '',
        snippet: buildSnippet((m.body as string | null) ?? '', q),
      });
    }
  }

  // Fetch conversation rows for both message hits and lead hits (RLS-scoped).
  const convIds = new Set<string>(byConv.keys());
  if (leadIds.length > 0) {
    const { data: convsByLead } = await supabase
      .from('conversations')
      .select('id')
      .in('lead_id', leadIds)
      .limit(limit);
    for (const c of convsByLead ?? []) convIds.add(c.id as string);
  }
  if (convIds.size === 0) return [];

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, channel, leads(full_name)')
    .in('id', [...convIds])
    .limit(limit);

  const hits: SearchHit[] = [];
  for (const c of convs ?? []) {
    const cid = c.id as string;
    const lead = c.leads as unknown as { full_name: string | null } | null;
    const existing = byConv.get(cid);
    hits.push({
      conversationId: cid,
      leadName: lead?.full_name ?? null,
      channel: String(c.channel),
      snippet: existing?.snippet ?? null,
    });
  }
  return hits.slice(0, limit);
}
