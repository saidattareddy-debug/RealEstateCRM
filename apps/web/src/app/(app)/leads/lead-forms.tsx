'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createLeadAction,
  importLeadsAction,
  addNoteAction,
  moveStageAction,
  assignLeadAction,
  resolveDuplicateAction,
  logCallAction,
  type ActionState,
} from './actions';

const initial: ActionState = {};

export function CreateLeadForm() {
  const [state, action, pending] = useActionState(createLeadAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field name="fullName" label="Full name" />
      <Field name="phone" label="Phone" />
      <Field name="email" label="Email" type="email" />
      <Field name="campaign" label="Campaign" />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Adding…' : 'Add lead'}
      </button>
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-success">{state.summary}</p> : null}
    </form>
  );
}

export function ImportLeadsForm() {
  const [state, action, pending] = useActionState(importLeadsAction, initial);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="csv"
        rows={4}
        placeholder={'name,phone,email\nAnita,9811112222,anita@x.test'}
        className="w-full rounded-md border border-border bg-surface-elevated p-2 font-mono text-xs text-text-primary"
      />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Importing…' : 'Import CSV'}
      </button>
      {state.error ? <p className="text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-success">{state.summary}</p> : null}
    </form>
  );
}

export function AddNoteForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(addNoteAction, initial);
  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <input
        name="body"
        required
        placeholder="Add a note…"
        className="flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? '…' : 'Note'}
      </button>
      {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function StageMover({
  leadId,
  stageId,
  stages,
}: {
  leadId: string;
  stageId: string | null;
  stages: { id: string; name: string; isLost?: boolean }[];
}) {
  const router = useRouter();
  const [state, action] = useActionState(moveStageAction, initial);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(stageId ?? '');
  const needsReason = stages.find((s) => s.id === selected)?.isLost ?? false;
  return (
    <form
      action={(fd) =>
        start(async () => {
          await action(fd);
          router.refresh();
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <select
        name="stageId"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={pending}
        aria-label="Pipeline stage"
        className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {needsReason ? (
        <input
          name="reason"
          required
          placeholder="Reason (required)"
          aria-label="Lost / disqualification reason"
          className="w-48 rounded-md border border-terracotta bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      ) : null}
      <button type="submit" disabled={pending} className={btn}>
        Move
      </button>
      {state.error ? <span className="w-full text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function CallLogForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(logCallAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-wrap gap-2">
        <select name="direction" aria-label="Direction" className={input}>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <select name="status" aria-label="Outcome status" className={input}>
          <option value="connected">Connected</option>
          <option value="no_answer">No answer</option>
          <option value="busy">Busy</option>
          <option value="wrong_number">Wrong number</option>
          <option value="switched_off">Switched off</option>
          <option value="callback_requested">Callback requested</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          name="durationSeconds"
          type="number"
          min={0}
          placeholder="Secs"
          aria-label="Duration seconds"
          className={`${input} w-20`}
        />
      </div>
      <input
        name="outcome"
        placeholder="Outcome / next action"
        aria-label="Outcome"
        className={`${input} w-full`}
      />
      <textarea
        name="notes"
        rows={2}
        placeholder="Notes…"
        className="w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary"
      />
      <label className="flex flex-col text-xs text-text-secondary">
        Schedule callback (optional)
        <input name="callbackAt" type="datetime-local" className={`${input} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Logging…' : 'Log call'}
      </button>
      {state.error ? <p className="text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-success">Call logged.</p> : null}
    </form>
  );
}

export function AssignSelect({
  leadId,
  currentAgentId,
  agents,
}: {
  leadId: string;
  currentAgentId: string | null;
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      value={currentAgentId ?? ''}
      disabled={pending}
      aria-label="Assigned agent"
      onChange={(e) =>
        start(async () => {
          await assignLeadAction(leadId, e.target.value);
          router.refresh();
        })
      }
      className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
    >
      <option value="">— unassigned —</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function ResolveButtons({
  duplicateId,
  broker = false,
}: {
  duplicateId: string;
  broker?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [precedence, setPrecedence] = useState('');
  const [exposure, setExposure] = useState('');
  function go(action: 'merge' | 'dismiss') {
    start(async () => {
      await resolveDuplicateAction(
        duplicateId,
        action,
        broker && action === 'merge'
          ? {
              sourcePrecedence: precedence || undefined,
              commissionExposure: Number(exposure) || undefined,
            }
          : undefined,
      );
      router.refresh();
    });
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {broker ? (
        <>
          <input
            value={precedence}
            onChange={(e) => setPrecedence(e.target.value)}
            placeholder="Source precedence"
            aria-label="Source precedence"
            className="w-32 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary"
          />
          <input
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
            placeholder="Commission ₹"
            aria-label="Commission exposure"
            className="w-28 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary"
          />
        </>
      ) : null}
      <button type="button" disabled={pending} onClick={() => go('merge')} className={btn}>
        Merge
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => go('dismiss')}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated"
      >
        Dismiss
      </button>
    </span>
  );
}

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';

function Field({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        type={type}
        name={name}
        className="mt-1 w-40 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
    </label>
  );
}
