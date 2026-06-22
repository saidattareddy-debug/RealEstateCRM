'use client';

import { useActionState, useState } from 'react';
import {
  createAutomationAction,
  toggleAutomationAction,
  updateAutomationAction,
  deleteAutomationAction,
  type ActionState,
} from './actions';

const initial: ActionState = {};

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const btnGhost =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60';
const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary';

function Feedback({ state, okMsg }: { state: ActionState; okMsg: string }) {
  if (state.error) return <p className="text-sm text-terracotta">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-success">{okMsg}</p>;
  return null;
}

export function CreateAutomationForm({
  triggers,
  triggerLabels,
}: {
  triggers: string[];
  triggerLabels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(createAutomationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" required className={input} placeholder="Notify on hot lead" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="trigger">
          Trigger
        </label>
        <select id="trigger" name="trigger" className={input} defaultValue={triggers[0]}>
          {triggers.map((t) => (
            <option key={t} value={t}>
              {triggerLabels[t] ?? t}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Creating…' : 'Create'}
      </button>
      <Feedback state={state} okMsg="Automation created." />
    </form>
  );
}

export function AutomationToggle({
  automationId,
  enabled,
}: {
  automationId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(toggleAutomationAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="automationId" value={automationId} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      <button type="submit" disabled={pending} className={btnGhost}>
        {pending ? '…' : enabled ? 'Disable' : 'Enable'}
      </button>
      {state.error ? <span className="ml-2 text-xs text-terracotta">{state.error}</span> : null}
    </form>
  );
}

interface ActionRow {
  type: string;
  params: Record<string, unknown>;
}

const ACTION_OPTIONS: { value: string; label: string; send: boolean }[] = [
  { value: 'create_task', label: 'Create task', send: false },
  { value: 'change_stage', label: 'Change stage', send: false },
  { value: 'assign_lead', label: 'Assign lead', send: false },
  { value: 'add_tag', label: 'Add tag', send: false },
  { value: 'add_note', label: 'Add note', send: false },
  { value: 'notify_user', label: 'Notify user', send: false },
  { value: 'enroll_sequence', label: 'Enroll in sequence', send: false },
  { value: 'unenroll_sequence', label: 'Unenroll from sequence', send: false },
  { value: 'send_whatsapp_template', label: 'Send WhatsApp (suppressed)', send: true },
  { value: 'send_email', label: 'Send email (suppressed)', send: true },
];

export function AutomationEditor({
  automationId,
  name,
  trigger,
  triggers,
  triggerLabels,
  maxRunsPerLead,
  initialActions,
}: {
  automationId: string;
  name: string;
  trigger: string;
  triggers: string[];
  triggerLabels: Record<string, string>;
  maxRunsPerLead: number | null;
  initialActions: ActionRow[];
}) {
  const [state, action, pending] = useActionState(updateAutomationAction, initial);
  const [actions, setActions] = useState<ActionRow[]>(initialActions);

  function addAction() {
    setActions((a) => [...a, { type: 'create_task', params: {} }]);
  }
  function removeAction(i: number) {
    setActions((a) => a.filter((_, idx) => idx !== i));
  }
  function setType(i: number, type: string) {
    setActions((a) => a.map((row, idx) => (idx === i ? { ...row, type } : row)));
  }
  function setParam(i: number, key: string, value: string) {
    setActions((a) =>
      a.map((row, idx) => (idx === i ? { ...row, params: { ...row.params, [key]: value } } : row)),
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="automationId" value={automationId} />
      <input type="hidden" name="actions" value={JSON.stringify(actions)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" defaultValue={name} required className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="trigger">
            Trigger
          </label>
          <select id="trigger" name="trigger" defaultValue={trigger} className={input}>
            {triggers.map((t) => (
              <option key={t} value={t}>
                {triggerLabels[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="maxRunsPerLead">
            Max runs per lead (optional)
          </label>
          <input
            id="maxRunsPerLead"
            name="maxRunsPerLead"
            type="number"
            min={1}
            defaultValue={maxRunsPerLead ?? ''}
            className={input}
            placeholder="Unlimited"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">Actions (run in order)</p>
          <button type="button" onClick={addAction} className={btnGhost}>
            Add action
          </button>
        </div>
        {actions.length === 0 ? (
          <p className="text-sm text-text-secondary">No actions yet.</p>
        ) : (
          <ul className="space-y-3">
            {actions.map((row, i) => {
              const opt = ACTION_OPTIONS.find((o) => o.value === row.type);
              return (
                <li key={i} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.type}
                      onChange={(e) => setType(i, e.target.value)}
                      className={input}
                    >
                      {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => removeAction(i)} className={btnGhost}>
                      Remove
                    </button>
                    {opt?.send && (
                      <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-medium text-terracotta">
                        Suppressed — never sent
                      </span>
                    )}
                  </div>
                  <ActionParams row={row} index={i} onParam={setParam} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save automation'}
        </button>
        <Feedback state={state} okMsg="Automation saved." />
      </div>
    </form>
  );
}

function ActionParams({
  row,
  index,
  onParam,
}: {
  row: ActionRow;
  index: number;
  onParam: (i: number, key: string, value: string) => void;
}) {
  const fields: { key: string; label: string }[] = (() => {
    switch (row.type) {
      case 'create_task':
        return [
          { key: 'taskTitle', label: 'Task title' },
          { key: 'assigneeId', label: 'Assignee user id (optional)' },
        ];
      case 'change_stage':
        return [{ key: 'stageId', label: 'Target stage id' }];
      case 'assign_lead':
        return [{ key: 'assigneeId', label: 'Agent user id' }];
      case 'add_tag':
        return [{ key: 'tag', label: 'Tag' }];
      case 'add_note':
        return [{ key: 'body', label: 'Note body' }];
      case 'notify_user':
        return [
          { key: 'userId', label: 'Recipient user id' },
          { key: 'title', label: 'Title' },
          { key: 'body', label: 'Body (optional)' },
        ];
      case 'enroll_sequence':
      case 'unenroll_sequence':
        return [{ key: 'sequenceId', label: 'Sequence id' }];
      case 'send_whatsapp_template':
      case 'send_email':
        return [{ key: 'templateId', label: 'Template id (recorded only)' }];
      default:
        return [];
    }
  })();

  if (fields.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">{f.label}</label>
          <input
            value={typeof row.params[f.key] === 'string' ? (row.params[f.key] as string) : ''}
            onChange={(e) => onParam(index, f.key, e.target.value)}
            className={input}
          />
        </div>
      ))}
    </div>
  );
}

export function DeleteAutomationForm({ automationId }: { automationId: string }) {
  const [state, action, pending] = useActionState(deleteAutomationAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="automationId" value={automationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-terracotta/40 px-3 py-1.5 text-sm font-medium text-terracotta hover:bg-terracotta/5 disabled:opacity-60"
      >
        {pending ? 'Deleting…' : 'Delete automation'}
      </button>
      {state.error ? <span className="ml-2 text-xs text-terracotta">{state.error}</span> : null}
    </form>
  );
}
