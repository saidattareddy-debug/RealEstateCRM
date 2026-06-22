'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignConversationAction,
  assignTeamAction,
  setOwnerLockAction,
  resolveOwnerMismatchAction,
  listAgentEligibilityAction,
  type AgentEligibility,
} from './assign-actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const ghost =
  'rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60';

/**
 * Interactive assignment (Phase 4.1, Priority 4). Loads per-agent eligibility on
 * demand; only eligible agents are assignable, ineligible agents are shown with
 * their exclusion reasons to authorised managers. Respects the ownership lock.
 */
export function AssignControl({
  conversationId,
  ownerLocked,
  teams,
  assignedTeamId,
}: {
  conversationId: string;
  ownerLocked: boolean;
  teams: { id: string; name: string }[];
  assignedTeamId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [agents, setAgents] = useState<AgentEligibility[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else setError(null);
      router.refresh();
    });

  const loadAgents = () =>
    start(async () => {
      setAgents(await listAgentEligibilityAction(conversationId));
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghost} disabled={pending} onClick={loadAgents}>
          {agents ? 'Refresh agents' : 'Assign agent…'}
        </button>
        <button
          type="button"
          className={ghost}
          disabled={pending}
          onClick={() => run(() => assignConversationAction(conversationId, null))}
        >
          Move to unassigned
        </button>
        <button
          type="button"
          className={ghost}
          disabled={pending}
          onClick={() => run(() => setOwnerLockAction(conversationId, !ownerLocked))}
        >
          {ownerLocked ? 'Unlock ownership' : 'Lock ownership'}
        </button>
      </div>

      {teams.length > 0 ? (
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          Team
          <select
            defaultValue={assignedTeamId ?? ''}
            disabled={pending || ownerLocked}
            aria-label="Assign team"
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            onChange={(e) => run(() => assignTeamAction(conversationId, e.target.value || null))}
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {agents ? (
        agents.length === 0 ? (
          <p className="text-xs text-text-secondary">No candidate agents.</p>
        ) : (
          <ul className="space-y-1 rounded-md border border-border p-2 text-sm">
            {agents.map((a) => (
              <li key={a.agentId} className="flex items-center justify-between gap-2">
                <span className={a.eligible ? 'text-text-primary' : 'text-text-secondary'}>
                  {a.name}
                  {!a.eligible ? (
                    <span className="ml-1 text-[10px] text-terracotta">
                      ({a.reasons.join(', ')})
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={btn}
                  disabled={pending || !a.eligible || ownerLocked}
                  onClick={() => run(() => assignConversationAction(conversationId, a.agentId))}
                >
                  Assign
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {error ? <p className="text-xs text-terracotta">{error}</p> : null}
      {ownerLocked ? (
        <p className="text-[10px] text-text-secondary">
          Ownership is locked — unlock before assigning.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Owner-mismatch resolver. Shows both owners, never syncs silently, requires a
 * reason, and lets an authorised manager pick the direction (or keep them
 * different). Assignment/transfer history is preserved by the underlying action.
 */
export function OwnerMismatchResolver({
  conversationId,
  conversationOwnerName,
  leadOwnerName,
}: {
  conversationId: string;
  conversationOwnerName: string;
  leadOwnerName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resolve = (choice: 'conversation_from_lead' | 'lead_from_conversation' | 'leave') =>
    start(async () => {
      const res = await resolveOwnerMismatchAction(conversationId, choice, reason);
      if (res?.error) setError(res.error);
      else {
        setError(null);
        setReason('');
        router.refresh();
      }
    });

  return (
    <div className="mt-2 space-y-2 rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm">
      <p className="text-terracotta">
        ⚠ Owner mismatch — conversation owner <strong>{conversationOwnerName}</strong> differs from
        lead owner <strong>{leadOwnerName}</strong>. Nothing is synced automatically.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        aria-label="Resolution reason"
        className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ghost}
          disabled={pending || !reason.trim()}
          onClick={() => resolve('conversation_from_lead')}
        >
          Set conversation owner from lead
        </button>
        <button
          type="button"
          className={ghost}
          disabled={pending || !reason.trim()}
          onClick={() => resolve('lead_from_conversation')}
        >
          Set lead owner from conversation
        </button>
        <button
          type="button"
          className={ghost}
          disabled={pending || !reason.trim()}
          onClick={() => resolve('leave')}
        >
          Keep different
        </button>
      </div>
      {error ? <p className="text-xs text-terracotta">{error}</p> : null}
    </div>
  );
}
