'use client';

import { useActionState } from 'react';
import { markReadAction, markAllReadAction, type ActionState } from './actions';

const initial: ActionState = {};

const btnGhost =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60';

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const [, action, pending] = useActionState(markReadAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <button type="submit" disabled={pending} className={btnGhost}>
        {pending ? '…' : 'Mark read'}
      </button>
    </form>
  );
}

export function MarkAllReadButton() {
  const [, action, pending] = useActionState(async () => markAllReadAction(), initial);
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className={btnGhost}>
        {pending ? '…' : 'Mark all read'}
      </button>
    </form>
  );
}
