'use server';

import { decodeCursor, encodeCursor, isAfterCursor } from '@re/domain';
import type { MessagePage, TransportMessage } from '@/lib/transport/types';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { markReadAction } from './ops-actions';

const PAGE = 50;

/**
 * Cursor-based incremental fetch (Phase 4.1, Priority 2). RLS-scoped: the query
 * runs under the caller's session, so an opaque/forged cursor can never return
 * messages from a conversation they cannot see. Stable order by (created_at, id);
 * redacted bodies are never returned (replaced with a placeholder).
 */
export async function fetchSinceAction(
  conversationId: string,
  cursor?: string,
): Promise<MessagePage> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'conversations.read.assigned')) {
    return { messages: [], nextCursor: cursor ?? null, hasMore: false };
  }
  const pos = decodeCursor(cursor);
  const supabase = await createSupabaseServerClient();

  // Fetch from the cursor timestamp onward, then apply the exact (ts,id) cut in
  // memory so equal-timestamp rows are neither skipped nor repeated.
  let query = supabase
    .from('conversation_messages')
    .select('id, conversation_id, direction, sender, body, redacted, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGE + 1);
  if (pos) query = query.gte('created_at', pos.createdAt);
  const { data } = await query;

  const rows = (data ?? [])
    .filter((m) => isAfterCursor({ createdAt: m.created_at as string, id: m.id as string }, pos))
    .slice(0, PAGE);

  const messages: TransportMessage[] = rows.map((m) => {
    const redacted = Boolean(m.redacted);
    return {
      id: m.id as string,
      conversationId: m.conversation_id as string,
      direction: m.direction as TransportMessage['direction'],
      sender: m.sender as TransportMessage['sender'],
      body: redacted ? '[redacted]' : ((m.body as string | null) ?? null),
      redacted,
      createdAt: m.created_at as string,
    };
  });

  const last = messages[messages.length - 1];
  return {
    messages,
    nextCursor: last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : (cursor ?? null),
    hasMore: (data?.length ?? 0) > rows.length,
  };
}

/** Mark-read passthrough for the transport (own-row only, enforced by RLS). */
export async function markReadViaTransport(
  conversationId: string,
  lastReadMessageId?: string,
): Promise<void> {
  await markReadAction(conversationId, lastReadMessageId);
}
