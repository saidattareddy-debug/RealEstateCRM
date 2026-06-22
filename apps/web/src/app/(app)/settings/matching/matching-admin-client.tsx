'use client';

import { useState, useTransition } from 'react';
import {
  createDraftMatchVersion,
  submitMatchVersionForApproval,
  approveMatchVersion,
  activateMatchVersion,
  retireMatchVersion,
} from './actions';

const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';

export interface MatchVersionCaps {
  canManage: boolean;
  canApprove: boolean;
}

export function MatchVersionActions({
  versionId,
  modelId,
  status,
  caps,
}: {
  versionId: string;
  modelId: string;
  status: string;
  caps: MatchVersionCaps;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Failed.');
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {caps.canManage && status === 'draft' ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => act(() => submitMatchVersionForApproval(versionId))}
        >
          Submit for approval
        </button>
      ) : null}
      {caps.canApprove && status === 'pending_approval' ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => act(() => approveMatchVersion(versionId))}
        >
          Approve
        </button>
      ) : null}
      {caps.canManage && (status === 'pending_approval' || status === 'draft') ? (
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() => act(() => activateMatchVersion(versionId))}
        >
          Activate
        </button>
      ) : null}
      {caps.canManage && status === 'active' ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => act(() => retireMatchVersion(versionId))}
        >
          Retire
        </button>
      ) : null}
      {caps.canManage ? (
        <CloneButton modelId={modelId} sourceVersionId={versionId} disabled={pending} />
      ) : null}
      {error ? <span className="text-xs text-terracotta">{error}</span> : null}
    </div>
  );
}

function CloneButton({
  modelId,
  sourceVersionId,
  disabled,
}: {
  modelId: string;
  sourceVersionId: string;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={btn} disabled={disabled} onClick={() => setOpen(true)}>
        Clone to new draft
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="new version label e.g. v2"
        className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary"
        disabled={pending}
      />
      <button
        type="button"
        className={btnPrimary}
        disabled={pending || !label.trim()}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createDraftMatchVersion({ modelId, sourceVersionId, version: label });
            if (!res.ok) setError(res.error ?? 'Failed.');
            else setOpen(false);
          })
        }
      >
        Create
      </button>
      <button type="button" className={btn} disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error ? <span className="text-xs text-terracotta">{error}</span> : null}
    </span>
  );
}
