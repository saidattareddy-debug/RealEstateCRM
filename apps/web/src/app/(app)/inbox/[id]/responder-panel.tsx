'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { runResponderAction } from '../../ai/actions';

const OUTCOME_CLASS: Record<string, string> = {
  suppressed: 'bg-warning/15 text-warning',
  escalate: 'bg-terracotta/15 text-terracotta',
  blocked: 'bg-border/60 text-text-secondary',
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        OUTCOME_CLASS[outcome] ?? 'bg-border/60 text-text-secondary',
      )}
    >
      {outcome}
    </span>
  );
}

export interface ResponderDecisionRow {
  id: string;
  outcome: string;
  reason: string;
  candidate_body: string | null;
  created_at: string;
}

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';

export function ResponderPanel({
  conversationId,
  canRun,
  decisions,
}: {
  conversationId: string;
  canRun: boolean;
  decisions: ResponderDecisionRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = () => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await runResponderAction(conversationId);
      if (res.error || !res.ok) {
        setError(res.error ?? 'Could not run the responder.');
        return;
      }
      setNotice(`Recorded: ${res.outcome} — not sent (automatic sending is disabled).`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Records what the automatic responder <em>would</em> do. It never sends — automatic delivery
        is disabled, so a grounded reply is logged as <strong>suppressed</strong> for review.
      </p>

      {canRun ? (
        <button type="button" className={btn} onClick={run} disabled={pending}>
          {pending ? 'Running…' : 'Run responder (no send)'}
        </button>
      ) : null}

      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {notice ? <p className="text-sm text-forest">{notice}</p> : null}

      {decisions.length === 0 ? (
        <p className="text-sm text-text-secondary">No responder decisions for this conversation.</p>
      ) : (
        <ul className="divide-y divide-border">
          {decisions.map((d) => (
            <li key={d.id} className="space-y-1 py-2">
              <div className="flex items-center justify-between gap-2">
                <OutcomeBadge outcome={d.outcome} />
                <span className="text-xs text-text-secondary">
                  {new Date(d.created_at).toLocaleString()}
                </span>
              </div>
              <p className="font-mono text-xs text-text-secondary">{d.reason}</p>
              {d.candidate_body ? (
                <p className="line-clamp-3 text-sm text-text-primary">
                  <span className="text-text-secondary">Would-be reply (not sent): </span>
                  {d.candidate_body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
