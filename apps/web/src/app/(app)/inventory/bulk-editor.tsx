'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { INVENTORY_STATUSES } from '@re/domain';
import { Panel } from '@/components/ui/card';
import { bulkUpdateUnitStatusAction } from './actions';

export function BulkEditor({
  units,
}: {
  units: { id: string; unit_number: string; project: string; status: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>('available');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === units.length ? new Set() : new Set(units.map((u) => u.id))));
  }

  function apply() {
    setMsg(null);
    start(async () => {
      const res = await bulkUpdateUnitStatusAction([...selected], status);
      if (res.ok) {
        setMsg(`Updated ${res.summary?.imported ?? selected.size} unit(s).`);
        setSelected(new Set());
        router.refresh();
      } else {
        setMsg(res.error ?? 'Failed.');
      }
    });
  }

  if (units.length === 0) return null;

  return (
    <Panel title="Bulk status editor">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-elevated"
        >
          {selected.size === units.length ? 'Clear all' : 'Select all'}
        </button>
        <span className="text-xs text-text-secondary">{selected.size} selected</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="New status"
          className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {INVENTORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={apply}
          disabled={pending || selected.size === 0}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Applying…' : 'Apply to selected'}
        </button>
        {msg ? <span className="text-sm text-text-secondary">{msg}</span> : null}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-b border-border/50 last:border-0">
                <td className="w-8 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    aria-label={`Select ${u.unit_number}`}
                  />
                </td>
                <td className="px-2 py-1 text-text-secondary">{u.project}</td>
                <td className="px-2 py-1 font-medium text-text-primary">{u.unit_number}</td>
                <td className="px-2 py-1 capitalize text-text-secondary">
                  {u.status.replace('_', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
