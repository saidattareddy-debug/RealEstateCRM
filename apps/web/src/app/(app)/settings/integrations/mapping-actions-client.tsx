'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSourceMapping } from './actions';

const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';

export function MappingForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sourceRef, setSourceRef] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createSourceMapping({
        sourceRef,
        leadSource: leadSource || null,
        channel: channel || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSourceRef('');
      setLeadSource('');
      setChannel('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Source reference
          <input
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            disabled={pending}
            maxLength={120}
            className={`mt-1 w-56 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Lead source
          <input
            value={leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
            disabled={pending}
            maxLength={60}
            className={`mt-1 w-40 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Channel
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            disabled={pending}
            maxLength={60}
            className={`mt-1 w-40 ${input}`}
          />
        </label>
        <button type="submit" disabled={pending || sourceRef.trim() === ''} className={btnPrimary}>
          {pending ? 'Adding…' : 'Add mapping'}
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
    </form>
  );
}
