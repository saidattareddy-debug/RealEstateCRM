'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestEventReplay } from './actions';

export function ReplayButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const res = await requestEventReplay({ eventId, reason });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason('');
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated"
      >
        Replay
      </button>
    );
  }
  return (
    <div className="ml-auto flex items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        disabled={pending}
        className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || reason.trim().length < 3}
        className="rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50"
      >
        {pending ? '…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        className="text-xs text-text-secondary hover:underline"
      >
        Cancel
      </button>
      {error ? <span className="text-xs text-terracotta">{error}</span> : null}
    </div>
  );
}
