'use client';

import { useActionState, useMemo, useState } from 'react';
import { UNIT_IMPORT_FIELDS } from '@re/domain';
import { Panel } from '@/components/ui/card';
import { parseCsv } from '@/lib/inventory/csv';
import { importInventoryAction, type ActionState } from '../actions';

const initial: ActionState = {};
const FIELD_LABELS: Record<string, string> = {
  unit_number: 'Unit number (required)',
  status: 'Status',
  price: 'Price',
  carpet_area_sqft: 'Carpet area (sqft)',
  configuration_label: 'Configuration',
};

type Parsed = { headers: string[]; rows: Record<string, string>[] };

/** Auto-guess a mapping by case-insensitive header match. */
function autoMap(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of UNIT_IMPORT_FIELDS) {
    const guess = headers.find((h) =>
      h
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .includes(field.replace(/_/g, '').slice(0, 4)),
    );
    if (guess) out[field] = guess;
  }
  return out;
}

export function ImportClient({ projects }: { projects: { id: string; name: string }[] }) {
  const [csv, setCsv] = useState('');
  const [fileData, setFileData] = useState<Parsed | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(importInventoryAction, initial);

  // Source of truth: an uploaded file (CSV/XLSX) wins, else the pasted CSV.
  const parsed: Parsed = useMemo(
    () => fileData ?? (csv.trim() ? parseCsv(csv) : { headers: [], rows: [] }),
    [fileData, csv],
  );

  function remap(headers: string[]) {
    if (headers.length) setMapping(autoMap(headers));
  }

  function onPaste(text: string) {
    setFileData(null);
    setCsv(text);
    remap(text.trim() ? parseCsv(text).headers : []);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      onPaste(text);
      return;
    }
    // XLSX — parse in the browser via SheetJS (dynamically imported).
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    const ws = firstSheet ? wb.Sheets[firstSheet] : undefined;
    if (!ws) return;
    const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
    const headers = (grid[0] ?? []).map((h) => String(h).trim());
    const rows = grid.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = String(r[i] ?? '').trim()));
      return obj;
    });
    setCsv('');
    setFileData({ headers, rows });
    remap(headers);
  }

  return (
    <div className="space-y-6">
      <Panel title="1 · Upload CSV/XLSX or paste CSV">
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mb-3 block text-sm text-text-secondary"
        />
        <textarea
          value={csv}
          onChange={(e) => onPaste(e.target.value)}
          rows={5}
          placeholder={'Unit,Type,Status,Price\nA-101,2 BHK,available,6600000'}
          className="w-full rounded-md border border-border bg-surface-elevated p-2 font-mono text-xs text-text-primary"
        />
        {parsed.headers.length > 0 ? (
          <p className="mt-2 text-xs text-text-secondary">
            Detected {parsed.headers.length} columns, {parsed.rows.length} data rows.
          </p>
        ) : null}
      </Panel>

      {parsed.headers.length > 0 ? (
        <Panel title="2 · Map columns">
          <div className="flex flex-wrap gap-4">
            {UNIT_IMPORT_FIELDS.map((field) => (
              <label key={field} className="flex flex-col text-xs text-text-secondary">
                {FIELD_LABELS[field]}
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
                >
                  <option value="">— none —</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="3 · Import">
        <form action={action} className="space-y-3">
          <input type="hidden" name="rowsJson" value={JSON.stringify(parsed.rows)} />
          <input
            type="hidden"
            name="mapping"
            value={JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))}
          />
          <input type="hidden" name="projectId" value={projectId} />
          <label className="flex flex-col text-xs text-text-secondary">
            Into project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 w-64 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending || !mapping.unit_number || parsed.rows.length === 0}
            className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
          >
            {pending ? 'Importing…' : 'Run import'}
          </button>
          {state.error ? <p className="text-sm text-terracotta">{state.error}</p> : null}
          {state.ok && state.summary ? (
            <p className="text-sm text-success">
              Imported {state.summary.imported} of {state.summary.total} rows ·{' '}
              {state.summary.errors} error(s).
            </p>
          ) : null}
        </form>
      </Panel>
    </div>
  );
}
