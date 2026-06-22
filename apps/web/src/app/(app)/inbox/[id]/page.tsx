import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { ReplyForm, ConversationControls, OpsBar, NoteForm } from '../inbox-forms';
import {
  addWorkingMinutes,
  standardWeek,
  computeSlaStatus,
  detectOwnerMismatch,
  encodeCursor,
} from '@re/domain';
import type { TransportMessage } from '@/lib/transport/types';
import { MessageThread } from './message-thread';
import { AssignControl, OwnerMismatchResolver } from '../assign-control';
import { MobileSheet } from './mobile-sheet';
import { Copilot } from './copilot';
import { ResponderPanel, type ResponderDecisionRow } from './responder-panel';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'conversations.read.assigned')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select(
      'id, channel, status, lifecycle, operating_mode, priority, waiting_on, ai_active, language, human_takeover_at, assigned_agent_id, assigned_team_id, owner_locked, first_response_at, last_inbound_at, lead_id, leads(id, full_name, primary_phone_national, primary_email, operational_status, score)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!conv) notFound();

  const [{ data: messages }, { data: summary }, { data: events }, { data: responderRows }] =
    await Promise.all([
      supabase
        .from('conversation_messages')
        .select('id, conversation_id, direction, sender, body, redacted, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(200),
      supabase
        .from('conversation_summaries')
        .select('summary, unanswered_question, recommended_next_action, source, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('conversation_events')
        .select('id, type, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(8),
      // Phase 5B (no-send): recent responder decisions for this conversation.
      supabase
        .from('ai_responder_decisions')
        .select('id, outcome, reason, candidate_body, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
  const responderDecisions = (responderRows ?? []) as ResponderDecisionRow[];

  const canReply = ensurePermission(ctx, 'conversations.reply');
  const canTakeover = ensurePermission(ctx, 'conversations.takeover');
  const canResume = ensurePermission(ctx, 'conversations.ai.resume');
  const canTransfer = ensurePermission(ctx, 'conversations.transfer');
  const canStatus =
    ensurePermission(ctx, 'conversations.close') || ensurePermission(ctx, 'conversations.reopen');
  const canPriority = ensurePermission(ctx, 'conversations.priority.manage');
  const canNote = ensurePermission(ctx, 'conversations.notes.create');

  const [{ data: notes }, { data: statusHist }, { data: prioHist }, { data: transferHist }] =
    await Promise.all([
      supabase
        .from('conversation_notes')
        .select('id, body, visibility, pinned, created_at')
        .eq('conversation_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('conversation_status_history')
        .select('id, previous_value, new_value, reason, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('conversation_priority_history')
        .select('id, previous_value, new_value, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('conversation_transfer_events')
        .select('id, from_agent_id, to_agent_id, reason, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

  let agents: { id: string; name: string }[] = [];
  if (canTransfer) {
    const { data: members } = await supabase
      .from('memberships')
      .select('profile_id, profiles(full_name), roles!inner(slug)')
      .eq('roles.slug', 'sales_agent');
    agents = (members ?? []).map((m) => ({
      id: m.profile_id as string,
      name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? 'Agent',
    }));
  }

  const lead = conv.leads as unknown as {
    id: string;
    full_name: string | null;
    primary_phone_national: string | null;
    primary_email: string | null;
    operational_status: string;
    score: number;
  } | null;

  // SLA: due = first_response_minutes of working time from the first inbound,
  // using the tenant's active policy (default Mon–Fri 9–18) → status.
  const [{ data: policy }, { data: leadAssignment }] = await Promise.all([
    supabase
      .from('conversation_sla_policies')
      .select('first_response_minutes, working_hours')
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    lead?.id
      ? supabase
          .from('lead_assignments')
          .select('agent_id')
          .eq('lead_id', lead.id)
          .eq('active', true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const firstResponseMinutes = (policy?.first_response_minutes as number | null) ?? 15;
  const wh = standardWeek(0); // tenant tz offset wiring is tracked in TECH_DEBT
  const lastInbound = conv.last_inbound_at as string | null;
  const dueAt = lastInbound
    ? addWorkingMinutes(new Date(lastInbound), firstResponseMinutes, wh).toISOString()
    : null;
  const now = new Date();
  const slaStatus = computeSlaStatus({
    dueAt,
    firstResponseAt: (conv.first_response_at as string | null) ?? null,
    lifecycle: String(conv.lifecycle ?? 'open') as never,
    waitingOn: String(conv.waiting_on ?? 'none') as never,
    now,
  });
  const ownerMismatch = detectOwnerMismatch(
    (conv.assigned_agent_id as string | null) ?? null,
    (leadAssignment?.agent_id as string | null) ?? null,
  );

  const canAssign = ensurePermission(ctx, 'conversations.assign');
  const convOwnerId = (conv.assigned_agent_id as string | null) ?? null;
  const leadOwnerId = (leadAssignment?.agent_id as string | null) ?? null;
  const ownerIds = [convOwnerId, leadOwnerId].filter((x): x is string => Boolean(x));
  const [{ data: teamRows }, { data: ownerProfiles }] = await Promise.all([
    canAssign
      ? supabase.from('teams').select('id, name').eq('active', true).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ownerIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);
  const nameOf = (pid: string | null) =>
    pid ? ((ownerProfiles ?? []).find((p) => p.id === pid)?.full_name ?? 'an agent') : 'unassigned';
  const teams = (teamRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string }));

  // Seed the live thread from the server-rendered page; polling resumes from the
  // last message's opaque cursor so the SSR page is never re-fetched.
  const initialMessages: TransportMessage[] = (messages ?? []).map((m) => {
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
  const lastInitial = initialMessages[initialMessages.length - 1];
  const initialCursor = lastInitial
    ? encodeCursor({ createdAt: lastInitial.createdAt, id: lastInitial.id })
    : undefined;
  const conversationClosed =
    String(conv.status) === 'closed' || String(conv.lifecycle) === 'closed';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {lead?.full_name ?? lead?.primary_phone_national ?? 'Conversation'}
          </h1>
          <p className="text-sm text-text-secondary">
            {String(conv.channel).replace('_', ' ')} · {String(conv.lifecycle ?? conv.status)} ·
            priority {String(conv.priority ?? 'normal')} · mode{' '}
            {String(conv.operating_mode ?? 'human')} · waiting on{' '}
            {String(conv.waiting_on ?? 'none')}
          </p>
        </div>
        <Link href="/inbox" className="text-sm text-forest hover:underline">
          ← Inbox
        </Link>
      </div>

      <MobileSheet title="Actions">
        <ConversationControls
          conversationId={conv.id as string}
          operatingMode={String(conv.operating_mode ?? 'human')}
          status={String(conv.status)}
          canTakeover={canTakeover}
          canResume={canResume}
          canTransfer={canTransfer}
          canReply={canReply}
          agents={agents}
        />

        <OpsBar
          conversationId={conv.id as string}
          lifecycle={String(conv.lifecycle ?? 'open')}
          priority={String(conv.priority ?? 'normal')}
          canStatus={canStatus}
          canPriority={canPriority}
        />
      </MobileSheet>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Messages">
            <MessageThread
              conversationId={conv.id as string}
              initialMessages={initialMessages}
              initialCursor={initialCursor}
              closed={conversationClosed}
            />
          </Panel>

          {canReply && conv.status !== 'closed' ? (
            <Panel title="Reply">
              <ReplyForm conversationId={conv.id as string} />
              <p className="mt-2 text-xs text-text-secondary">
                Sending pauses nothing here, but the future AI responder is paused while a human has
                taken over. Do-not-contact and revoked consent are enforced before send.
              </p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="Lead">
            {lead ? (
              <dl className="space-y-1 text-sm">
                <Row label="Name" value={lead.full_name ?? '—'} />
                <Row label="Phone" value={lead.primary_phone_national ?? '—'} />
                <Row label="Email" value={lead.primary_email ?? '—'} />
                <Row label="Status" value={String(lead.operational_status)} />
                <Row label="Score" value={String(lead.score)} />
                <div className="pt-2">
                  <Link href={`/leads/${lead.id}`} className="text-sm text-forest hover:underline">
                    Open lead →
                  </Link>
                </div>
              </dl>
            ) : (
              <EmptyState title="No linked lead" />
            )}
          </Panel>

          <Panel title="Summary">
            {summary ? (
              <div className="space-y-2 text-sm">
                <p className="text-text-primary">{summary.summary as string}</p>
                {summary.unanswered_question ? (
                  <p className="text-terracotta">Open question: {summary.unanswered_question}</p>
                ) : null}
                {summary.recommended_next_action ? (
                  <p className="text-text-secondary">
                    Next: {summary.recommended_next_action as string}
                  </p>
                ) : null}
                <p className="text-xs text-text-secondary">
                  {String(summary.source)} ·{' '}
                  {new Date(summary.created_at as string).toLocaleString()}
                </p>
              </div>
            ) : (
              <EmptyState
                title="No summary yet"
                hint="Use “Generate summary” for a deterministic roll-up (AI summaries arrive in Phase 5)."
              />
            )}
          </Panel>

          <Panel title="AI copilot">
            <Copilot
              conversationId={conv.id as string}
              canCopilot={ensurePermission(ctx, 'ai.copilot.use')}
            />
          </Panel>

          {ensurePermission(ctx, 'ai.runs.read') ? (
            <Panel title="AI responder (no send)">
              <ResponderPanel
                conversationId={conv.id as string}
                canRun={ensurePermission(ctx, 'ai.shadow.manage')}
                decisions={responderDecisions}
              />
            </Panel>
          ) : null}

          <Panel title="Internal notes">
            <p className="mb-2 text-xs text-text-secondary">
              Internal only — never sent to the customer.
            </p>
            {canNote ? (
              <div className="mb-3">
                <NoteForm conversationId={conv.id as string} />
              </div>
            ) : null}
            {!notes || notes.length === 0 ? (
              <EmptyState title="No notes" />
            ) : (
              <ul className="space-y-2 text-sm">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-md border border-warning/40 bg-warning/5 p-2 text-text-primary"
                  >
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="text-[10px] text-text-secondary">
                      {String(n.visibility)} · {new Date(n.created_at as string).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Ownership & SLA">
            <dl className="space-y-1 text-sm">
              <Row
                label="SLA"
                value={
                  slaStatus === 'breached'
                    ? 'Breached'
                    : slaStatus === 'due_soon'
                      ? 'Due soon'
                      : slaStatus === 'paused'
                        ? 'Paused'
                        : 'On track'
                }
              />
              {dueAt ? (
                <Row label="First-response due" value={new Date(dueAt).toLocaleString()} />
              ) : null}
              <Row label="Owner locked" value={conv.owner_locked ? 'Yes' : 'No'} />
              <Row label="Conversation owner" value={nameOf(convOwnerId)} />
              <Row label="Lead owner" value={nameOf(leadOwnerId)} />
            </dl>
            {canAssign ? (
              <div className="mt-3">
                <AssignControl
                  conversationId={conv.id as string}
                  ownerLocked={Boolean(conv.owner_locked)}
                  teams={teams}
                  assignedTeamId={(conv.assigned_team_id as string | null) ?? null}
                />
              </div>
            ) : null}
            {ownerMismatch.mismatch && canAssign ? (
              <OwnerMismatchResolver
                conversationId={conv.id as string}
                conversationOwnerName={nameOf(convOwnerId)}
                leadOwnerName={nameOf(leadOwnerId)}
              />
            ) : ownerMismatch.mismatch ? (
              <p className="mt-2 rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm text-terracotta">
                ⚠ Conversation owner differs from the lead owner. A manager must resolve this.
              </p>
            ) : null}
          </Panel>

          <Panel title="History">
            {(!statusHist || statusHist.length === 0) &&
            (!prioHist || prioHist.length === 0) &&
            (!transferHist || transferHist.length === 0) ? (
              <EmptyState title="No changes yet" />
            ) : (
              <ul className="space-y-1 text-xs text-text-secondary">
                {(statusHist ?? []).map((h) => (
                  <li key={`s-${h.id}`}>
                    status {String(h.previous_value ?? '—')} → {String(h.new_value)}
                    {h.reason ? ` · ${String(h.reason)}` : ''} ·{' '}
                    {new Date(h.created_at as string).toLocaleString()}
                  </li>
                ))}
                {(prioHist ?? []).map((h) => (
                  <li key={`p-${h.id}`}>
                    priority {String(h.previous_value ?? '—')} → {String(h.new_value)} ·{' '}
                    {new Date(h.created_at as string).toLocaleString()}
                  </li>
                ))}
                {(transferHist ?? []).map((h) => (
                  <li key={`t-${h.id}`}>
                    transferred{h.reason ? ` · ${String(h.reason)}` : ''} ·{' '}
                    {new Date(h.created_at as string).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity">
            {!events || events.length === 0 ? (
              <EmptyState title="No events" />
            ) : (
              <ul className="space-y-1 text-xs text-text-secondary">
                {events.map((e) => (
                  <li key={e.id}>
                    {String(e.type)} · {new Date(e.created_at as string).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="capitalize text-text-primary">{value}</dd>
    </div>
  );
}
