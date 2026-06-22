'use client';

import { useState, useTransition } from 'react';
import {
  recalculateLeadScore,
  applyScoreOverride,
  removeScoreOverride,
} from '../../scoring/actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const btnSecondary =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const CLASSIFICATIONS = [
  'hot',
  'warm',
  'cold',
  'disqualified',
  'unscored',
  'review_required',
] as const;

export function RecalculateButton({ leadId }: { leadId: string }) {
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
            const res = await recalculateLeadScore(leadId);
            setMsg(res.ok ? 'Recalculated.' : (res.error ?? 'Failed.'));
          })
        }
      >
        {pending ? 'Recalculating…' : 'Recalculate score'}
      </button>
      {msg ? <span className="text-xs text-text-secondary">{msg}</span> : null}
    </div>
  );
}

export function OverrideForm({
  leadId,
  hasActiveOverride,
}: {
  leadId: string;
  hasActiveOverride: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState('');
  const [classification, setClassification] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError('A reason (min 3 chars) is required.');
      return;
    }
    start(async () => {
      const res = await applyScoreOverride({
        leadId,
        score: score.trim() === '' ? null : Number(score),
        classification: classification
          ? (classification as (typeof CLASSIFICATIONS)[number])
          : null,
        reason,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      if (res.ok) {
        setOpen(false);
        setScore('');
        setClassification('');
        setReason('');
        setExpiresAt('');
      } else {
        setError(res.error ?? 'Failed to apply override.');
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => setOpen((o) => !o)}>
          {open ? 'Cancel override' : 'Manager override'}
        </button>
        {hasActiveOverride ? (
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await removeScoreOverride(leadId);
                if (!res.ok) setError(res.error ?? 'Failed to remove override.');
              })
            }
          >
            Remove active override
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-elevated p-3">
          <p className="text-xs text-text-secondary">
            An override sets an effective score/classification with a reason. It never erases the
            calculated run and never changes the lead’s stage, assignment or status.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-text-secondary">Effective score (optional)</span>
              <input
                value={score}
                onChange={(e) => setScore(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 75"
                className={field}
                disabled={pending}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-text-secondary">Effective classification (optional)</span>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className={field}
                disabled={pending}
              >
                <option value="">No change</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-text-secondary">Reason (required)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is a manual override warranted?"
              className={field}
              disabled={pending}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-text-secondary">Expires at (optional)</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={field}
              disabled={pending}
            />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className={btn} onClick={submit} disabled={pending}>
              {pending ? 'Applying…' : 'Apply override'}
            </button>
            {error ? <span className="text-sm text-terracotta">{error}</span> : null}
          </div>
        </div>
      ) : null}
      {error && !open ? <span className="text-sm text-terracotta">{error}</span> : null}
    </div>
  );
}
