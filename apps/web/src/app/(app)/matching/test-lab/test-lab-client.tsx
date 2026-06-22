'use client';

import { useState, useTransition } from 'react';
import { runMatchingTestLab, type MatchingTestLabState } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const sel =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const VALUE_TYPES = ['boolean', 'number', 'string', 'string[]', 'range'] as const;
const LEVELS = ['project', 'configuration', 'unit'] as const;

type PrefRow = { signalKey: string; value: string; valueType: (typeof VALUE_TYPES)[number] };
type CandRow = {
  label: string;
  level: (typeof LEVELS)[number];
  locality: string;
  category: string;
  amenities: string;
  priceMin: string;
  priceMax: string;
  unitPrice: string;
  unitStatus: string;
  verifiedDaysAgo: string;
  excludedByLead: boolean;
};

type Version = { id: string; label: string; status: string };

const emptyPref = (): PrefRow => ({ signalKey: '', value: '', valueType: 'string' });
const emptyCand = (): CandRow => ({
  label: '',
  level: 'project',
  locality: '',
  category: '',
  amenities: '',
  priceMin: '',
  priceMax: '',
  unitPrice: '',
  unitStatus: 'available',
  verifiedDaysAgo: '0',
  excludedByLead: false,
});

export function MatchingTestLabClient({ versions }: { versions: Version[] }) {
  const activeDefault = versions.find((v) => v.status === 'active')?.id ?? versions[0]?.id ?? '';
  const [versionId, setVersionId] = useState(activeDefault);
  const [prefs, setPrefs] = useState<PrefRow[]>([
    { signalKey: 'budget', value: '4000000-6000000', valueType: 'range' },
    { signalKey: 'locality', value: 'Whitefield', valueType: 'string' },
  ]);
  const [cands, setCands] = useState<CandRow[]>([emptyCand()]);
  const [pending, start] = useTransition();
  const [state, setState] = useState<MatchingTestLabState | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const updatePref = (i: number, patch: Partial<PrefRow>) =>
    setPrefs((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateCand = (i: number, patch: Partial<CandRow>) =>
    setCands((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const run = () => {
    setClientError(null);
    const candidates = cands.map((c) => ({
      label: c.label || undefined,
      level: c.level,
      locality: c.locality || undefined,
      category: c.category || undefined,
      amenities: c.amenities || undefined,
      priceMin: c.priceMin ? Number(c.priceMin) : undefined,
      priceMax: c.priceMax ? Number(c.priceMax) : undefined,
      unitPrice: c.unitPrice ? Number(c.unitPrice) : undefined,
      unitStatus: c.unitStatus || undefined,
      verifiedDaysAgo: c.verifiedDaysAgo ? Number(c.verifiedDaysAgo) : undefined,
      excludedByLead: c.excludedByLead,
    }));
    if (candidates.length === 0) {
      setClientError('Add at least one candidate.');
      return;
    }
    start(async () => {
      const result = await runMatchingTestLab({
        modelVersionId: versionId || null,
        preferences: prefs.filter((p) => p.signalKey.trim().length > 0),
        candidates,
      });
      setState(result);
    });
  };

  const result = state?.result;

  return (
    <div className="space-y-5">
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-bold text-warning"
      >
        <span aria-hidden>⚠</span>
        TEST MODE — NO LEAD, PROJECT OR INVENTORY UPDATED. This lab runs the deterministic engine on
        synthetic data only. It never writes to the database, never assigns a lead, never reserves
        inventory, and never sends anything.
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Model version</span>
        <select
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          aria-label="Model version"
          className={`${sel} w-full`}
          disabled={pending}
        >
          {versions.length === 0 ? <option value="">No versions</option> : null}
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Synthetic lead preferences
        </h3>
        {prefs.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input
              value={r.signalKey}
              onChange={(e) => updatePref(i, { signalKey: e.target.value })}
              placeholder="signal_key (e.g. budget, locality, amenities)"
              aria-label={`Preference key ${i + 1}`}
              className={field}
              disabled={pending}
            />
            <input
              value={r.value}
              onChange={(e) => updatePref(i, { value: e.target.value })}
              placeholder="value (4000000-6000000 / Whitefield / pool,gym)"
              aria-label={`Preference value ${i + 1}`}
              className={field}
              disabled={pending}
            />
            <select
              value={r.valueType}
              onChange={(e) => updatePref(i, { valueType: e.target.value as PrefRow['valueType'] })}
              aria-label={`Preference type ${i + 1}`}
              className={sel}
              disabled={pending}
            >
              {VALUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPrefs((rs) => rs.filter((_, idx) => idx !== i))}
              className="rounded-md border border-border px-2 py-1 text-sm text-text-secondary hover:text-terracotta"
              disabled={pending || prefs.length === 1}
              aria-label={`Remove preference ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPrefs((rs) => [...rs, emptyPref()])}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated"
          disabled={pending}
        >
          + Add preference
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Synthetic candidates
        </h3>
        {cands.map((c, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <LabeledInput
                label="Label"
                value={c.label}
                onChange={(v) => updateCand(i, { label: v })}
                disabled={pending}
              />
              <label className="block space-y-1 text-xs">
                <span className="text-text-secondary">Level</span>
                <select
                  value={c.level}
                  onChange={(e) => updateCand(i, { level: e.target.value as CandRow['level'] })}
                  className={`${sel} w-full`}
                  disabled={pending}
                  aria-label={`Candidate level ${i + 1}`}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <LabeledInput
                label="Locality"
                value={c.locality}
                onChange={(v) => updateCand(i, { locality: v })}
                disabled={pending}
              />
              <LabeledInput
                label="Category"
                value={c.category}
                onChange={(v) => updateCand(i, { category: v })}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <LabeledInput
                label="Amenities (csv)"
                value={c.amenities}
                onChange={(v) => updateCand(i, { amenities: v })}
                disabled={pending}
              />
              <LabeledInput
                label="Price min"
                value={c.priceMin}
                onChange={(v) => updateCand(i, { priceMin: v })}
                disabled={pending}
              />
              <LabeledInput
                label="Price max"
                value={c.priceMax}
                onChange={(v) => updateCand(i, { priceMax: v })}
                disabled={pending}
              />
              {c.level === 'unit' ? (
                <LabeledInput
                  label="Unit price"
                  value={c.unitPrice}
                  onChange={(v) => updateCand(i, { unitPrice: v })}
                  disabled={pending}
                />
              ) : (
                <div />
              )}
            </div>
            {c.level === 'unit' ? (
              <div className="grid gap-2 sm:grid-cols-4">
                <LabeledInput
                  label="Unit status"
                  value={c.unitStatus}
                  onChange={(v) => updateCand(i, { unitStatus: v })}
                  disabled={pending}
                />
                <LabeledInput
                  label="Verified days ago"
                  value={c.verifiedDaysAgo}
                  onChange={(v) => updateCand(i, { verifiedDaysAgo: v })}
                  disabled={pending}
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={c.excludedByLead}
                onChange={(e) => updateCand(i, { excludedByLead: e.target.checked })}
                disabled={pending}
              />
              Excluded by lead
            </label>
            <button
              type="button"
              onClick={() => setCands((rs) => rs.filter((_, idx) => idx !== i))}
              className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:text-terracotta"
              disabled={pending || cands.length === 1}
            >
              Remove candidate
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setCands((rs) => [...rs, emptyCand()])}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated"
          disabled={pending}
        >
          + Add candidate
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className={btn}>
          {pending ? 'Calculating…' : 'Run match (dry run)'}
        </button>
        {clientError ? <span className="text-sm text-terracotta">{clientError}</span> : null}
        {state?.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
      </div>

      {result ? <MatchingResult result={result} modelVersion={state?.modelVersion} /> : null}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-text-secondary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={field}
        disabled={disabled}
        aria-label={label}
      />
    </label>
  );
}

function MatchingResult({
  result,
  modelVersion,
}: {
  result: NonNullable<MatchingTestLabState['result']>;
  modelVersion?: string;
}) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge label={`candidates: ${result.rankedCandidates.length}`} tone="neutral" />
        {modelVersion ? <Badge label={`version: ${modelVersion}`} tone="neutral" /> : null}
      </div>

      <div className="space-y-3">
        {result.rankedCandidates.map((c) => (
          <div key={c.candidateId} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge label={`#${c.rank} ${c.level}`} tone="neutral" />
              <Badge
                label={c.classification}
                tone={
                  c.classification === 'excellent' || c.classification === 'good'
                    ? 'success'
                    : c.classification === 'ineligible'
                      ? 'terracotta'
                      : c.classification === 'review_required'
                        ? 'warning'
                        : 'neutral'
                }
              />
              <Badge label={`score: ${c.score}`} tone="neutral" />
              <Badge
                label={`eligible: ${c.eligible ? 'yes' : 'no'}`}
                tone={c.eligible ? 'success' : 'terracotta'}
              />
              <Badge label={`confidence: ${(c.confidence * 100).toFixed(0)}%`} tone="neutral" />
              <Badge
                label={`completeness: ${(c.preferenceCompleteness * 100).toFixed(0)}%`}
                tone="neutral"
              />
              <Badge label={`inventory: ${c.inventoryState}`} tone="neutral" />
              <Badge label={`budget: ${c.budgetOutcome}`} tone="neutral" />
            </div>

            {c.level === 'unit' ? (
              <p className="text-xs text-text-secondary">
                Unit confirmed available:{' '}
                <span className={c.unitConfirmedAvailable ? 'text-forest' : 'text-terracotta'}>
                  {c.unitConfirmedAvailable ? 'yes' : 'no'}
                </span>
              </p>
            ) : null}

            {c.hardFailures.length > 0 ? (
              <p className="text-sm text-terracotta">Exclusions: {c.hardFailures.join(', ')}</p>
            ) : null}
            {c.reviewRequired ? (
              <p className="text-sm text-warning">Review required: {c.reviewReason ?? '—'}</p>
            ) : null}
            {c.missingPreferences.length > 0 ? (
              <p className="text-sm text-text-secondary">
                Missing preferences: {c.missingPreferences.join(', ')}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Positive components
                </h4>
                {c.positiveComponents.length === 0 ? (
                  <p className="text-sm text-text-secondary">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {c.positiveComponents.map((p, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="text-text-primary">
                          {p.signalKey} ({p.group})
                        </span>
                        <span className="text-forest">+{p.contribution}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Negative / unmet
                </h4>
                {c.negativeComponents.length === 0 ? (
                  <p className="text-sm text-text-secondary">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {c.negativeComponents.map((n, i) => (
                      <li key={i}>
                        {n.signalKey} ({n.group}) — {n.skippedReason ?? 'unmet'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {c.explanation.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
                {c.explanation.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-xs text-text-secondary">
        This was a dry run against synthetic data. No lead, project or inventory was modified.
      </p>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'terracotta' | 'neutral';
}) {
  const cls =
    tone === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'terracotta'
          ? 'border-terracotta/40 bg-terracotta/10 text-terracotta'
          : 'border-border bg-surface-elevated text-text-secondary';
  return <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{label}</span>;
}
