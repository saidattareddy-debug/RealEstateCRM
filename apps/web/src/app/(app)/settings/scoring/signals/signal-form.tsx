'use client';

import { useState, useTransition } from 'react';
import { createSignalDefinition } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const CATEGORIES = [
  'intent',
  'fit',
  'engagement',
  'source',
  'freshness',
  'negative',
  'qualification',
] as const;
const VALUE_TYPES = ['boolean', 'number', 'string', 'string[]'] as const;

export function SignalForm() {
  const [pending, start] = useTransition();
  const [signalKey, setSignalKey] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('intent');
  const [valueType, setValueType] = useState<(typeof VALUE_TYPES)[number]>('boolean');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    setMsg(null);
    if (!signalKey.trim()) {
      setMsg({ ok: false, text: 'Provide a signal key.' });
      return;
    }
    start(async () => {
      const res = await createSignalDefinition({
        signalKey: signalKey.trim(),
        category,
        valueType,
        description: description.trim() || undefined,
      });
      if (res.ok) {
        setSignalKey('');
        setDescription('');
        setMsg({ ok: true, text: 'Signal created.' });
      } else {
        setMsg({ ok: false, text: res.error ?? 'Failed.' });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Signal key</span>
          <input
            value={signalKey}
            onChange={(e) => setSignalKey(e.target.value)}
            placeholder="e.g. ready_to_book"
            className={field}
            disabled={pending}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            className={field}
            disabled={pending}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Value type</span>
          <select
            value={valueType}
            onChange={(e) => setValueType(e.target.value as (typeof VALUE_TYPES)[number])}
            className={field}
            disabled={pending}
          >
            {VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Description (optional)</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={field}
          disabled={pending}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Add signal'}
        </button>
        {msg ? (
          <span className={`text-sm ${msg.ok ? 'text-forest' : 'text-terracotta'}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-text-secondary">
        Protected/sensitive traits are rejected — they can never be scoring inputs.
      </p>
    </div>
  );
}
