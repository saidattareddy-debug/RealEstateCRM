'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { AuditLogRow } from '@/lib/audit/audit-query';

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

export function AuditClient({
  rows,
  categories,
  current,
}: {
  rows: AuditLogRow[];
  categories: string[];
  current: { action: string; category: string; entityType: string; from: string; to: string };
}) {
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  return (
    <div className="space-y-4">
      {/* Filters — GET form re-renders the server page with new search params */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <label className="flex flex-col text-xs text-text-secondary">
          Category
          <select
            name="category"
            defaultValue={current.category}
            className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Action
          <input
            name="action"
            defaultValue={current.action}
            placeholder="e.g. tenant.switch"
            className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Entity type
          <input
            name="entityType"
            defaultValue={current.entityType}
            className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          From
          <input
            type="date"
            name="from"
            defaultValue={current.from}
            className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          To
          <input
            type="date"
            name="to"
            defaultValue={current.to}
            className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
        >
          Apply
        </button>
      </form>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-secondary">
            No audit records match these filters.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-text-secondary">{fmt(r.created_at)}</td>
                  <td className="px-4 py-2 font-medium text-text-primary">{r.action}</td>
                  <td className="px-4 py-2 text-text-secondary">
                    {r.actor_role ?? r.actor_user_id ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-text-secondary">
                    {r.entity_type
                      ? `${r.entity_type}${r.entity_id ? `:${r.entity_id.slice(0, 8)}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="rounded-md px-2 py-1 text-xs text-forest hover:bg-surface-elevated"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Event-detail drawer */}
      {selected ? (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close details"
            className="flex-1 bg-black/30"
            onClick={() => setSelected(null)}
          />
          <aside className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">Audit record</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md p-1 text-text-secondary hover:bg-surface-elevated"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <Detail label="Action" value={selected.action} />
              <Detail label="Time" value={fmt(selected.created_at)} />
              <Detail label="Actor user" value={selected.actor_user_id ?? '—'} />
              <Detail label="Actor role" value={selected.actor_role ?? '—'} />
              <Detail
                label="Entity"
                value={`${selected.entity_type ?? '—'} ${selected.entity_id ?? ''}`}
              />
              <Detail label="IP" value={selected.ip_address ?? '—'} />
              <Detail label="User agent" value={selected.user_agent ?? '—'} />
              <Detail label="Request ID" value={selected.request_id ?? '—'} />
              <Detail label="Correlation ID" value={selected.correlation_id ?? '—'} />
            </dl>
            <JsonBlock label="Previous values" value={selected.previous_values} />
            <JsonBlock label="New values" value={selected.new_values} />
            <JsonBlock label="Metadata" value={selected.metadata} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-all text-right text-text-primary">{value}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-md border border-border bg-surface-elevated p-2 text-xs text-text-primary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
