'use client';

import { useState, useTransition } from 'react';
import { runSyntheticEmailTest, type EmailTestResult } from './actions';

const SAMPLE = `Name: Asha Verma
Phone: +91 98765 43210
Project: Green Acres
Locality: Whitefield
Budget: 1.2 Cr
Message: Interested in a 3BHK, please call back.

> On Mon, someone wrote:
> previous thread should be stripped`;

export function EmailTestPanel({ provider }: { provider: string }) {
  const [pending, start] = useTransition();
  const [body, setBody] = useState(SAMPLE);
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await runSyntheticEmailTest({ provider, body });
      if (!res.ok) {
        setError(res.error ?? 'Failed.');
        return;
      }
      setResult(res);
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        rows={8}
        className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1 font-mono text-xs text-text-primary"
      />
      <button
        type="button"
        onClick={run}
        disabled={pending || body.trim() === ''}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-50"
      >
        {pending ? 'Parsing…' : 'Run synthetic parse'}
      </button>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {result ? (
        <div className="space-y-3 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                result.review
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-success/40 bg-success/10 text-success'
              }`}
            >
              {result.review ? 'review required' : 'parsed'}
            </span>
            <span className="text-xs text-text-secondary">
              confidence: {result.confidence} · {result.parserVersion}
            </span>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Parsed fields
            </p>
            <dl className="mt-1 grid grid-cols-2 gap-1">
              {Object.entries(result.fields ?? {}).map(([k, v]) =>
                v ? (
                  <div key={k} className="flex gap-2">
                    <dt className="text-text-secondary">{k}:</dt>
                    <dd className="text-text-primary">{v}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </div>
          {result.missingRequired && result.missingRequired.length > 0 ? (
            <p className="text-xs text-terracotta">
              Missing required: {result.missingRequired.join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
