'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { INVENTORY_STATUSES } from '@re/domain';
import {
  createUnitAction,
  updateUnitStatusAction,
  approveProjectAction,
  type ActionState,
} from '../actions';

export function ApproveButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await approveProjectAction(projectId);
          router.refresh();
        })
      }
      className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
    >
      {pending ? 'Approving…' : 'Approve project'}
    </button>
  );
}

const initial: ActionState = {};

export function AddUnitForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(createUnitAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-col text-xs text-text-secondary">
        Unit no.
        <input
          name="unitNumber"
          required
          className="mt-1 w-28 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Status
        <select
          name="status"
          defaultValue="available"
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {INVENTORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Price
        <input
          name="price"
          type="number"
          className="mt-1 w-32 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add unit'}
      </button>
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
    </form>
  );
}

export function StatusSelect({ unitId, value }: { unitId: string; value: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Unit status"
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          await updateUnitStatusAction(unitId, next);
          router.refresh();
        });
      }}
      className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary"
    >
      {INVENTORY_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace('_', ' ')}
        </option>
      ))}
    </select>
  );
}
