'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTaskAction, setTaskStatusAction, type ActionState } from './actions';

const initial: ActionState = {};

export function CreateTaskForm({ leadId }: { leadId?: string }) {
  const [state, action, pending] = useActionState(createTaskAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <label className="flex flex-col text-xs text-text-secondary">
        Task
        <input
          name="title"
          required
          className="mt-1 w-56 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Due
        <input
          type="date"
          name="dueAt"
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add task'}
      </button>
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-success">Task created.</p> : null}
    </form>
  );
}

export function TaskDoneButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setTaskStatusAction(taskId, 'done');
          router.refresh();
        })
      }
      className="rounded-md border border-border px-2 py-1 text-xs text-success hover:bg-surface-elevated disabled:opacity-60"
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}
