'use client';

import { useState, useTransition } from 'react';
import { runScoringTestLab, type ScoringTestLabState } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const sel =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const STATES = [
  'known',
  'unknown',
  'not_applicable',
  'contradictory',
  'stale',
  'unverified',
] as const;
const VALUE_TYPES = ['boolean', 'number', 'string', 'string[]'] as const;

type ObsRow = {
  signalKey: string;
  value: string;
  valueType: (typeof VALUE_TYPES)[number];
  state: (typeof STATES)[number];
};

type Version = { id: string; label: string; status: string };
type Signal = { key: string; valueType: string; category: string };

const emptyRow = (): ObsRow => ({
  signalKey: '',
  value: '',
  valueType: 'boolean',
  state: 'known',
});

export function ScoringTestLabClient({
  versions,
  signals,
}: {
  versions: Version[];
  signals: Signal[];
}) {
  const activeDefault = versions.find((v) => v.status === 'active')?.id ?? versions[0]?.id ?? '';
  const [versionId, setVersionId] = useState(activeDefault);
  const [rows, setRows] = useState<ObsRow[]>([emptyRow()]);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ScoringTestLabState | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<ObsRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const run = () => {
    setClientError(null);
    const obs = rows.filter((r) => r.signalKey.trim().length > 0);
    if (obs.length === 0) {
      setClientError('Add at least one observation with a signal key.');
      return;
    }
    start(async () => {
      const result = await runScoringTestLab({
        modelVersionId: versionId || null,
        observations: obs,
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
        TEST MODE — NO LEAD UPDATED. This lab runs the deterministic engine on synthetic
        observations only. It never writes to the database, never touches a lead, and never changes
        a score, stage, assignment or status.
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

      {signals.length > 0 ? (
        <p className="text-xs text-text-secondary">
          Known signal keys: {signals.map((s) => `${s.key} (${s.valueType})`).join(', ')}
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Synthetic observations
        </h3>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
            <input
              value={r.signalKey}
              onChange={(e) => update(i, { signalKey: e.target.value })}
              placeholder="signal_key"
              aria-label={`Signal key ${i + 1}`}
              className={field}
              disabled={pending}
              list="signal-keys"
            />
            <input
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="value (true / 80 / a,b)"
              aria-label={`Value ${i + 1}`}
              className={field}
              disabled={pending}
            />
            <select
              value={r.valueType}
              onChange={(e) => update(i, { valueType: e.target.value as ObsRow['valueType'] })}
              aria-label={`Value type ${i + 1}`}
              className={sel}
              disabled={pending}
            >
              {VALUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={r.state}
              onChange={(e) => update(i, { state: e.target.value as ObsRow['state'] })}
              aria-label={`State ${i + 1}`}
              className={sel}
              disabled={pending}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
              className="rounded-md border border-border px-2 py-1 text-sm text-text-secondary hover:text-terracotta"
              disabled={pending || rows.length === 1}
              aria-label={`Remove observation ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        <datalist id="signal-keys">
          {signals.map((s) => (
            <option key={s.key} value={s.key} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, emptyRow()])}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated"
          disabled={pending}
        >
          + Add observation
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className={btn}>
          {pending ? 'Calculating…' : 'Run score (dry run)'}
        </button>
        {clientError ? <span className="text-sm text-terracotta">{clientError}</span> : null}
        {state?.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
      </div>

      {result ? <ScoringResult result={result} modelVersion={state?.modelVersion} /> : null}
    </div>
  );
}

function ScoringResult({
  result,
  modelVersion,
}: {
  result: NonNullable<ScoringTestLabState['result']>;
  modelVersion?: string;
}) {
  const applied = result.components.filter((c) => c.applied);
  const skipped = result.components.filter((c) => !c.applied);
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge label={`score: ${result.score}`} tone="neutral" />
        <Badge
          label={`classification: ${result.classification}`}
          tone={
            result.classification === 'hot'
              ? 'success'
              : result.classification === 'disqualified'
                ? 'terracotta'
                : result.classification === 'review_required'
                  ? 'warning'
                  : 'neutral'
          }
        />
        <Badge
          label={`evidence: ${(result.evidenceCompleteness * 100).toFixed(0)}%`}
          tone="neutral"
        />
        <Badge
          label={`confidence: ${(result.calculationConfidence * 100).toFixed(0)}%`}
          tone="neutral"
        />
        <Badge
          label={`qualification: ${result.qualificationComplete ? 'complete' : 'incomplete'}`}
          tone="neutral"
        />
        {modelVersion ? <Badge label={`version: ${modelVersion}`} tone="neutral" /> : null}
      </div>

      {result.disqualification.disqualified ? (
        <div className="rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm text-terracotta">
          Disqualification recommended: {result.disqualification.reason ?? 'matched a rule'}
        </div>
      ) : null}
      {result.reviewRequired.required ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm text-warning">
          Review required: {result.reviewRequired.reason ?? 'flagged for review'}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={`Applied components (${applied.length})`}>
          {applied.length === 0 ? (
            <p className="text-sm text-text-secondary">No rules contributed.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {applied.map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-text-primary">
                    {c.signalKey} ({c.group})
                  </span>
                  <span className="text-forest">+{c.contribution}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Skipped components (${skipped.length})`}>
          {skipped.length === 0 ? (
            <p className="text-sm text-text-secondary">None skipped.</p>
          ) : (
            <ul className="space-y-1 text-sm text-text-secondary">
              {skipped.map((c, i) => (
                <li key={i}>
                  {c.signalKey} ({c.group}) — {c.skippedReason ?? 'skipped'}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Missing signals">
          {result.missingSignals.length === 0 ? (
            <p className="text-sm text-text-secondary">None.</p>
          ) : (
            <p className="text-sm text-text-primary">{result.missingSignals.join(', ')}</p>
          )}
        </Section>
        <Section title="Contradictions">
          {result.contradictions.length === 0 ? (
            <p className="text-sm text-text-secondary">None.</p>
          ) : (
            <p className="text-sm text-terracotta">{result.contradictions.join(', ')}</p>
          )}
        </Section>
      </div>

      <Section title="Explanation">
        {result.explanation.length === 0 ? (
          <p className="text-sm text-text-secondary">No explanation lines.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
            {result.explanation.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-xs text-text-secondary">
        This was a dry run against synthetic observations. No lead was scored or modified.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</h3>
      {children}
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
