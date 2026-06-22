'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createParserRule, setParserRuleActive } from './actions';

const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';

export function RuleManager({
  connectionId,
  mode,
  ruleId,
  active,
}: {
  connectionId: string;
  mode: 'create' | 'toggle';
  ruleId?: string;
  active?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [adapter, setAdapter] = useState('portal_keyvalue');
  const [error, setError] = useState<string | null>(null);

  if (mode === 'toggle' && ruleId) {
    return (
      <button
        type="button"
        disabled={pending}
        className={`ml-auto ${btn}`}
        onClick={() =>
          start(async () => {
            const res = await setParserRuleActive({ ruleId, active: !active });
            if (!res.error) router.refresh();
          })
        }
      >
        {active ? 'Disable' : 'Enable'}
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createParserRule({ connectionId, name, adapter, config: {} });
      if (res.error) {
        setError(res.error);
        return;
      }
      setName('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            maxLength={120}
            className={`mt-1 w-56 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Adapter
          <input
            value={adapter}
            onChange={(e) => setAdapter(e.target.value)}
            disabled={pending}
            maxLength={60}
            className={`mt-1 w-44 ${input}`}
          />
        </label>
        <button type="submit" disabled={pending || name.trim() === ''} className={btnPrimary}>
          {pending ? 'Adding…' : 'Add rule'}
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
    </form>
  );
}
