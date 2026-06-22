import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { needsResponse, slaChipLabel, type SlaStatus } from '@re/domain';
import { InboxSearch } from './inbox-search';
import { InboxViews } from './inbox-views';
import { listInboxViews } from './saved-view-actions';

export const dynamic = 'force-dynamic';

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My inbox' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'ai', label: 'AI-active' },
  { key: 'takeover', label: 'Human takeover' },
  { key: 'needs', label: 'Needs response' },
  { key: 'closed', label: 'Closed' },
];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; tag?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'conversations.read.assigned')) return <PermissionDenied />;
  const sp = await searchParams;
  const filter = sp.filter ?? 'all';
  const tagFilter = sp.tag ?? null;

  const supabase = await createSupabaseServerClient();

  // Tag filter is applied AFTER RLS: collect the visible conversations carrying
  // the tag, then intersect. A tag can never widen visibility.
  let tagConvIds: string[] | null = null;
  if (tagFilter) {
    const { data: assigned } = await supabase
      .from('conversation_tag_assignments')
      .select('conversation_id')
      .eq('tag_id', tagFilter);
    tagConvIds = (assigned ?? []).map((r) => r.conversation_id as string);
  }

  let q = supabase
    .from('conversations')
    .select(
      'id, channel, status, ai_active, assigned_agent_id, last_message_at, last_inbound_at, needs_response, sla_status, first_response_at, leads(full_name, primary_phone_national)',
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (filter === 'mine') q = q.eq('assigned_agent_id', ctx.userId);
  else if (filter === 'unassigned') q = q.is('assigned_agent_id', null);
  else if (filter === 'ai') q = q.eq('ai_active', true).neq('status', 'closed');
  else if (filter === 'takeover') q = q.eq('ai_active', false).neq('status', 'closed');
  else if (filter === 'needs') q = q.eq('needs_response', true).eq('status', 'open');
  else if (filter === 'closed') q = q.eq('status', 'closed');
  else q = q.neq('status', 'closed');

  if (tagConvIds !== null)
    q = q.in('id', tagConvIds.length ? tagConvIds : ['00000000-0000-0000-0000-000000000000']);

  const [{ data: conversations }, views, { data: tagRows }] = await Promise.all([
    q,
    listInboxViews(),
    supabase.from('conversation_tags').select('id, name').eq('active', true).order('name'),
  ]);
  const tags = (tagRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string }));
  const now = new Date();

  // Per-user unread: a conversation is unread for me when the last customer
  // message is newer than my own last-read marker (derived, not a global count).
  const { data: reads } = await supabase
    .from('conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('profile_id', ctx.userId);
  const lastReadByConv = new Map<string, string>(
    (reads ?? []).map((r) => [r.conversation_id as string, r.last_read_at as string]),
  );
  const isUnread = (c: { id: string; last_inbound_at: string | null }) => {
    if (!c.last_inbound_at) return false;
    const read = lastReadByConv.get(c.id);
    return !read || new Date(read).getTime() < new Date(c.last_inbound_at).getTime();
  };
  const unreadTotal = (conversations ?? []).filter((c) =>
    isUnread({ id: c.id as string, last_inbound_at: (c.last_inbound_at as string | null) ?? null }),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-text-primary">Inbox</h1>
          {unreadTotal > 0 ? (
            <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-medium text-terracotta">
              {unreadTotal} unread
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {ensurePermission(ctx, 'conversations.tags.manage') ? (
            <Link href="/settings/tags" className="text-forest hover:underline">
              Manage tags
            </Link>
          ) : null}
          {ensurePermission(ctx, 'canned_replies.manage') ? (
            <Link href="/settings/canned-replies" className="text-forest hover:underline">
              Canned replies
            </Link>
          ) : null}
        </div>
      </div>

      <InboxSearch />

      <InboxViews
        views={views}
        tags={tags}
        currentFilter={filter}
        currentTag={tagFilter}
        currentUserId={ctx.userId}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Inbox filters">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/inbox?filter=${f.key}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f.key
                ? 'border-forest bg-forest text-white'
                : 'border-border text-text-secondary hover:bg-surface-elevated'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <Panel>
        {!conversations || conversations.length === 0 ? (
          <EmptyState
            title="No conversations"
            hint="Conversations appear here as leads message in."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {conversations.map((c) => {
              const lead = c.leads as unknown as {
                full_name: string | null;
                primary_phone_national: string | null;
              } | null;
              const sla = needsResponse(
                {
                  status: c.status as 'open' | 'snoozed' | 'closed',
                  lastInboundAt: (c.last_inbound_at as string | null) ?? null,
                  lastMessageAt: (c.last_message_at as string | null) ?? null,
                },
                now,
              );
              return (
                <li key={c.id}>
                  <Link
                    href={`/inbox/${c.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 hover:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text-primary">
                        {lead?.full_name ?? lead?.primary_phone_national ?? 'Unknown lead'}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {String(c.channel).replace('_', ' ')} ·{' '}
                        {c.last_message_at
                          ? new Date(c.last_message_at as string).toLocaleString()
                          : 'no messages'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      {isUnread({
                        id: c.id as string,
                        last_inbound_at: (c.last_inbound_at as string | null) ?? null,
                      }) ? (
                        <span
                          aria-label="Unread"
                          className="inline-block h-2 w-2 rounded-full bg-terracotta"
                        />
                      ) : null}
                      {c.ai_active ? (
                        <Badge tone="ai">AI</Badge>
                      ) : (
                        <Badge tone="human">Human</Badge>
                      )}
                      {c.status === 'closed' ? <Badge tone="muted">Closed</Badge> : null}
                      <SlaChip
                        status={(c.sla_status as SlaStatus | null) ?? null}
                        firstResponded={Boolean(c.first_response_at)}
                      />
                      {sla.needsResponse ? (
                        <Badge tone={sla.overdue ? 'overdue' : 'wait'}>
                          {sla.overdue ? `Overdue ${sla.waitingMinutes}m` : 'Needs reply'}
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Real SLA chip driven by the persisted status (On Track / Due Soon / Breached / Paused). */
function SlaChip({
  status,
  firstResponded,
}: {
  status: SlaStatus | null;
  firstResponded: boolean;
}) {
  // Not applicable once a first response has landed and there is no live timer.
  if (!status || (firstResponded && status === 'on_track')) return null;
  const label = slaChipLabel(status, true);
  const tone =
    status === 'breached'
      ? 'overdue'
      : status === 'due_soon'
        ? 'wait'
        : status === 'paused'
          ? 'muted'
          : 'human';
  return <Badge tone={tone as 'overdue' | 'wait' | 'muted' | 'human'}>{label}</Badge>;
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ai' | 'human' | 'muted' | 'wait' | 'overdue';
}) {
  const tones: Record<string, string> = {
    ai: 'bg-forest/10 text-forest',
    human: 'bg-warning/10 text-warning',
    muted: 'bg-border/40 text-text-secondary',
    wait: 'bg-warning/10 text-warning',
    overdue: 'bg-terracotta/10 text-terracotta',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 ${tones[tone] ?? tones.muted}`}>{children}</span>
  );
}
