'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/ui/card';
import { bulkMoveStageAction } from './actions';

export function BulkLeadEditor({
  leads,
  stages,
}: {
  leads: { id: string; name: string }[];
  stages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (leads.length === 0 || stages.length === 0) return null;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function apply() {
    setMsg(null);
    start(async () => {
      const res = await bulkMoveStageAction([...selected], stageId);
      if (res.ok) {
        setMsg(`Moved ${selected.size} lead(s).`);
        setSelected(new Set());
        router.refresh();
      } else setMsg(res.error ?? 'Failed.');
    });
  }

  return (
    <Panel title="Bulk stage move">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            setSelected((s) =>
              s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)),
            )
          }
          className="rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-elevated"
        >
          {selected.size === leads.length ? 'Clear' : 'Select all'}
        </button>
        <span className="text-xs text-text-secondary">{selected.size} selected</span>
        <select
          value={stageId}
          onChange={(e) => setStageId(e.target.value)}
          aria-label="Target stage"
          className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={apply}
          disabled={pending || selected.size === 0}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Moving…' : 'Apply'}
        </button>
        {msg ? <span className="text-sm text-text-secondary">{msg}</span> : null}
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        <ul className="text-sm">
          {leads.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 border-b border-border/50 px-2 py-1 last:border-0"
            >
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={() => toggle(l.id)}
                aria-label={`Select ${l.name}`}
              />
              <span className="text-text-primary">{l.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
