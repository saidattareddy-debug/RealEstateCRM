'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/ui/card';
import {
  approveSource,
  rejectSource,
  archiveSource,
  rollbackToVersion,
  testRetrieval,
  type ActionState,
  type TestRetrievalState,
} from '../actions';

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60';

export function SourceControls({
  sourceId,
  versions,
  canReview,
  canApprove,
  canArchive,
}: {
  sourceId: string;
  versions: { version: number; state: string }[];
  canReview: boolean;
  canApprove: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [approveReason, setApproveReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [targetVersion, setTargetVersion] = useState(
    versions.length > 0 ? String(versions[versions.length - 1]!.version) : '1',
  );
  const [rollbackReason, setRollbackReason] = useState('');

  if (!canReview && !canApprove && !canArchive) return null;

  function run(fn: () => Promise<ActionState>, okMessage: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      setNotice(okMessage);
      router.refresh();
    });
  }

  return (
    <Panel title="Review actions">
      <div className="grid gap-4 lg:grid-cols-2">
        {canApprove ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-text-primary">Approve</p>
            <textarea
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              disabled={pending}
              rows={2}
              maxLength={500}
              placeholder="Reason (required) — recorded in the approval trail."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={pending || approveReason.trim().length === 0}
              onClick={() =>
                run(
                  () => approveSource({ sourceId, reason: approveReason.trim() }),
                  'Source approved.',
                )
              }
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
            >
              {pending ? 'Working…' : 'Approve source'}
            </button>
          </div>
        ) : null}

        {canReview ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-text-primary">Reject</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={pending}
              rows={2}
              maxLength={500}
              placeholder="Reason (required)."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={pending || rejectReason.trim().length === 0}
              onClick={() =>
                run(
                  () => rejectSource({ sourceId, reason: rejectReason.trim() }),
                  'Source rejected.',
                )
              }
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-terracotta hover:bg-surface-elevated disabled:opacity-60"
            >
              Reject source
            </button>
          </div>
        ) : null}

        {canArchive ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-text-primary">Archive</p>
            <textarea
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              disabled={pending}
              rows={2}
              maxLength={500}
              placeholder="Reason (optional)."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    archiveSource({
                      sourceId,
                      reason: archiveReason.trim() || undefined,
                    }),
                  'Source archived.',
                )
              }
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60"
            >
              Archive source
            </button>
          </div>
        ) : null}

        {canApprove && versions.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-text-primary">Roll back to version</p>
            <div className="flex items-center gap-2">
              <select
                value={targetVersion}
                onChange={(e) => setTargetVersion(e.target.value)}
                disabled={pending}
                className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} ({v.state.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              disabled={pending}
              rows={2}
              maxLength={500}
              placeholder="Reason (required)."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={pending || rollbackReason.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                    rollbackToVersion({
                      sourceId,
                      targetVersion: Number(targetVersion),
                      reason: rollbackReason.trim(),
                    }),
                  `Rolled back to v${targetVersion}.`,
                )
              }
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
            >
              Roll back
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-terracotta">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-success">{notice}</p> : null}
    </Panel>
  );
}

export function TestRetrievalBox({
  projectId,
  language,
}: {
  projectId: string | null;
  language: string;
}) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestRetrievalState['result'] | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await testRetrieval({ projectId, query: query.trim(), language });
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(res.result ?? null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Read-only preview: shows which approved chunks and sources would ground an answer to this
        query. Nothing is sent.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
          placeholder="e.g. What is the payment plan?"
          className="min-w-[16rem] flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || query.trim().length === 0}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Retrieving…' : 'Test retrieval'}
        </button>
      </form>

      {error ? <p className="text-sm text-terracotta">{error}</p> : null}

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-secondary">
            <span>Sufficiency: {result.sufficiency.toFixed(2)}</span>
            <span>Independent sources: {result.independentSources}</span>
            <span>Lexical: {result.lexicalCount}</span>
            <span>Vector: {result.vectorCount}</span>
            <span>Exact FAQ match: {result.exactFaqMatch ? 'yes' : 'no'}</span>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-text-secondary">Grounding sources</p>
            {result.sources.length === 0 ? (
              <p className="text-sm text-text-secondary">No grounding sources matched.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {result.sources.map((s, i) => (
                  <li
                    key={i}
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-text-primary"
                  >
                    {s.label} · trust {s.trustPriority}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-text-secondary">Retrieved chunks</p>
            {result.chunkPreviews.length === 0 ? (
              <p className="text-sm text-text-secondary">No chunks retrieved.</p>
            ) : (
              <ul className="space-y-2">
                {result.chunkPreviews.map((c) => (
                  <li
                    key={c.rank}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm"
                  >
                    <span className="mr-2 text-xs text-text-secondary">
                      #{c.rank} · score {c.score}
                    </span>
                    <span className="text-text-primary">{c.snippet}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
