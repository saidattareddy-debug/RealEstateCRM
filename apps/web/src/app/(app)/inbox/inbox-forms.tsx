'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  sendReplyAction,
  takeOverAction,
  resumeAiAction,
  transferConversationAction,
  closeConversationAction,
  generateSummaryAction,
  type ActionState,
} from './actions';
import { changeStatusAction, changePriorityAction, addConversationNoteAction } from './ops-actions';
import {
  listCannedRepliesForComposer,
  sendCannedReply,
  type ComposerCannedReply,
} from './canned-actions';

const initial: ActionState = {};
const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const ghost =
  'rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const sel =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';

const LIFECYCLES = ['open', 'paused', 'resolved', 'closed', 'spam', 'archived'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function OpsBar({
  conversationId,
  lifecycle,
  priority,
  canStatus,
  canPriority,
}: {
  conversationId: string;
  lifecycle: string;
  priority: string;
  canStatus: boolean;
  canPriority: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStatus ? (
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          Status
          <select
            defaultValue={lifecycle}
            disabled={pending}
            aria-label="Conversation status"
            className={sel}
            onChange={(e) =>
              run(() =>
                changeStatusAction(conversationId, e.target.value as never, reason || undefined),
              )
            }
          >
            {LIFECYCLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {canPriority ? (
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          Priority
          <select
            defaultValue={priority}
            disabled={pending}
            aria-label="Conversation priority"
            className={sel}
            onChange={(e) =>
              run(() =>
                changePriorityAction(conversationId, e.target.value as never, reason || undefined),
              )
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {canStatus || canPriority ? (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          aria-label="Change reason"
          className={`${sel} w-40`}
        />
      ) : null}
    </div>
  );
}

export function NoteForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(addConversationNoteAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea
        name="body"
        required
        rows={2}
        placeholder="Add an internal note…"
        className="w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary"
      />
      <div className="flex items-center gap-2">
        <select name="visibility" aria-label="Note visibility" className={sel} defaultValue="team">
          <option value="assigned_agent">Assigned agent</option>
          <option value="team">Team</option>
          <option value="manager_only">Manager only</option>
        </select>
        <button type="submit" disabled={pending} className={btn}>
          {pending ? '…' : 'Add note'}
        </button>
        {state.error ? <span className="text-xs text-terracotta">{state.error}</span> : null}
      </div>
    </form>
  );
}

/**
 * Canned-reply picker. Loads the agent's usable replies on first open and, on
 * selection, sends through the server-resolved enforced path (`sendCannedReply`).
 * It never injects raw text into the textarea — that would bypass server-side
 * variable resolution and the send-time guards.
 */
export function CannedPicker({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [replies, setReplies] = useState<ComposerCannedReply[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setLoading(true);
      void listCannedRepliesForComposer(conversationId)
        .then((rows) => {
          setReplies(rows);
          setLoaded(true);
        })
        .finally(() => setLoading(false));
    }
  };

  const pick = (id: string) =>
    start(async () => {
      setError(null);
      const res = await sendCannedReply(conversationId, id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-expanded={open}
        className={ghost}
      >
        {open ? 'Hide canned replies' : 'Canned replies'}
      </button>
      {open ? (
        <div className="rounded-md border border-border bg-surface p-2">
          {loading ? (
            <p className="text-xs text-text-secondary">Loading…</p>
          ) : replies.length === 0 ? (
            <p className="text-xs text-text-secondary">No canned replies available.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {replies.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r.id)}
                    disabled={pending}
                    className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60"
                  >
                    <span className="block font-medium">{r.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-text-secondary">
                      {r.body}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="mt-2 text-xs text-terracotta">{error}</p> : null}
          <p className="mt-2 text-[11px] text-text-secondary">
            Variables are filled in and sent on the server, with the same consent / DNC / takeover
            checks as a normal reply.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendReplyAction, initial);
  return (
    <div className="space-y-3">
      <CannedPicker conversationId={conversationId} />
      <form action={action} className="space-y-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="body"
          required
          rows={3}
          placeholder="Type a reply…"
          className="w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary"
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={btn}>
            {pending ? 'Sending…' : 'Send reply'}
          </button>
          {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
          {state.ok ? <span className="text-sm text-success">Sent.</span> : null}
        </div>
      </form>
    </div>
  );
}

export function ConversationControls({
  conversationId,
  operatingMode,
  status,
  canTakeover,
  canResume,
  canTransfer,
  canReply,
  agents,
}: {
  conversationId: string;
  operatingMode: string;
  status: string;
  canTakeover: boolean;
  canResume: boolean;
  canTransfer: boolean;
  canReply: boolean;
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [transferTo, setTransferTo] = useState('');
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  const humanControlled = operatingMode === 'human';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canTakeover && !humanControlled ? (
        <button
          type="button"
          disabled={pending}
          className={btn}
          onClick={() => run(() => takeOverAction(conversationId))}
        >
          Take over
        </button>
      ) : null}
      {canResume && humanControlled ? (
        // Ends the human takeover → moves to Paused. NEVER activates AI
        // (AI stays off until Phase 5; see canExecuteAutomatedReply).
        <button
          type="button"
          disabled={pending}
          className={ghost}
          onClick={() => run(() => resumeAiAction(conversationId))}
        >
          End takeover (pause)
        </button>
      ) : null}

      {canTransfer ? (
        <span className="flex items-center gap-1">
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            aria-label="Transfer to agent"
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          >
            <option value="">Transfer to…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !transferTo}
            className={ghost}
            onClick={() => run(() => transferConversationAction(conversationId, transferTo))}
          >
            Go
          </button>
        </span>
      ) : null}

      {canReply ? (
        <button
          type="button"
          disabled={pending}
          className={ghost}
          onClick={() => run(() => generateSummaryAction(conversationId))}
        >
          Generate summary
        </button>
      ) : null}

      {canReply ? (
        <button
          type="button"
          disabled={pending}
          className={ghost}
          onClick={() => run(() => closeConversationAction(conversationId, status === 'closed'))}
        >
          {status === 'closed' ? 'Reopen' : 'Close'}
        </button>
      ) : null}
    </div>
  );
}
