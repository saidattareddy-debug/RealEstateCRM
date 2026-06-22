'use client';

import { useState, useTransition } from 'react';
import {
  recalculateLeadMatch,
  applyLeadMatchOverride,
  submitLeadMatchFeedback,
} from '../../matching/actions';

const btnSecondary =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const btnSmall =
  'rounded-md border border-border px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const OVERRIDE_ACTIONS = ['include', 'exclude', 'rank', 'classification', 'review'] as const;
const FEEDBACK_KINDS = [
  'interested',
  'not_interested',
  'accepted',
  'rejected',
  'wrong_budget',
  'wrong_location',
  'wrong_configuration',
  'inventory_unavailable',
  'data_stale',
  'other',
] as const;

export function RecalculateMatchButton({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={btnSecondary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await recalculateLeadMatch(leadId);
            setMsg(res.ok ? 'Recalculated.' : (res.error ?? 'Failed.'));
          })
        }
      >
        {pending ? 'Recalculating…' : 'Recalculate matches'}
      </button>
      {msg ? <span className="text-xs text-text-secondary">{msg}</span> : null}
    </div>
  );
}

export function MatchFeedbackControl({
  leadId,
  runId,
  candidateId,
}: {
  leadId: string;
  runId: string | null;
  candidateId: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof FEEDBACK_KINDS)[number]>('interested');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button type="button" className={btnSmall} onClick={() => setOpen((o) => !o)}>
        {open ? 'Cancel feedback' : 'Feedback'}
      </button>
      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-elevated p-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof FEEDBACK_KINDS)[number])}
            className={field}
            disabled={pending}
            aria-label="Feedback kind"
          >
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="optional note"
            className={field}
            disabled={pending}
            aria-label="Feedback note"
          />
          <button
            type="button"
            className={btnSmall}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const res = await submitLeadMatchFeedback({
                  leadId,
                  runId,
                  candidateId,
                  kind,
                  reason: reason || null,
                });
                if (res.ok) {
                  setOpen(false);
                  setReason('');
                  setMsg('Recorded.');
                } else {
                  setMsg(res.error ?? 'Failed.');
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Submit'}
          </button>
          {msg ? <span className="ml-2 text-xs text-text-secondary">{msg}</span> : null}
        </div>
      ) : null}
      {!open && msg ? <span className="text-xs text-text-secondary">{msg}</span> : null}
    </div>
  );
}

export function MatchOverrideControl({
  leadId,
  runId,
  candidateId,
}: {
  leadId: string;
  runId: string | null;
  candidateId: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<(typeof OVERRIDE_ACTIONS)[number]>('exclude');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button type="button" className={btnSmall} onClick={() => setOpen((o) => !o)}>
        {open ? 'Cancel override' : 'Override'}
      </button>
      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-elevated p-2">
          <p className="text-xs text-text-secondary">
            An override is advisory: it adjusts this recommendation only. It never erases the
            calculated run, never changes inventory status, and never changes the lead’s
            stage/assignment/status/score.
          </p>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as (typeof OVERRIDE_ACTIONS)[number])}
            className={field}
            disabled={pending}
            aria-label="Override action"
          >
            {OVERRIDE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, min 3 chars)"
            className={field}
            disabled={pending}
            aria-label="Override reason"
          />
          <button
            type="button"
            className={btnSmall}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                if (reason.trim().length < 3) {
                  setError('A reason (min 3 chars) is required.');
                  return;
                }
                const res = await applyLeadMatchOverride({
                  leadId,
                  runId,
                  candidateId,
                  action,
                  reason,
                });
                if (res.ok) {
                  setOpen(false);
                  setReason('');
                } else {
                  setError(res.error ?? 'Failed.');
                }
              })
            }
          >
            {pending ? 'Applying…' : 'Apply override'}
          </button>
          {error ? <span className="ml-2 text-xs text-terracotta">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
