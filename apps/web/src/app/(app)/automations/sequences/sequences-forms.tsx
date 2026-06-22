'use client';

import { useActionState, useState } from 'react';
import {
  createSequenceAction,
  updateSequenceAction,
  enrollLeadAction,
  unenrollLeadAction,
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

export function CreateSequenceForm() {
  const [state, action, pending] = useActionState(createSequenceAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" required className={input} placeholder="New-lead nurture" />
      </div>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Creating…' : 'Create sequence'}
      </button>
      <Feedback state={state} okMsg="Sequence created." />
    </form>
  );
}

interface StepRow {
  delayHours: number;
  channel: string;
  templateId: string | null;
  onlyScoreCategories: string[];
}

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp (suppressed)' },
  { value: 'email', label: 'Email (suppressed)' },
  { value: 'task_reminder', label: 'Task reminder' },
];
const CATEGORIES = ['hot', 'warm', 'cold'];

export function SequenceEditor({
  id,
  name,
  enabled,
  stopOnReply,
  quietStartHour,
  quietEndHour,
  initialSteps,
}: {
  id: string;
  name: string;
  enabled: boolean;
  stopOnReply: boolean;
  quietStartHour: number;
  quietEndHour: number;
  initialSteps: StepRow[];
}) {
  const [state, action, pending] = useActionState(updateSequenceAction, initial);
  const [steps, setSteps] = useState<StepRow[]>(initialSteps);

  function addStep() {
    setSteps((s) => [
      ...s,
      { delayHours: 24, channel: 'task_reminder', templateId: null, onlyScoreCategories: [] },
    ]);
  }
  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }
  function patch(i: number, p: Partial<StepRow>) {
    setSteps((s) => s.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  }
  function toggleCategory(i: number, cat: string) {
    setSteps((s) =>
      s.map((row, idx) => {
        if (idx !== i) return row;
        const has = row.onlyScoreCategories.includes(cat);
        return {
          ...row,
          onlyScoreCategories: has
            ? row.onlyScoreCategories.filter((c) => c !== cat)
            : [...row.onlyScoreCategories, cat],
        };
      }),
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(
          steps.map((s) => ({
            delayHours: s.delayHours,
            channel: s.channel,
            templateId: s.templateId,
            onlyScoreCategories: s.onlyScoreCategories,
          })),
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" defaultValue={name} required className={input} />
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" name="enabled" value="true" defaultChecked={enabled} />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" name="stopOnReply" value="true" defaultChecked={stopOnReply} />
            Stop on reply
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="quietStartHour">
            Quiet hours start (0–23)
          </label>
          <input
            id="quietStartHour"
            name="quietStartHour"
            type="number"
            min={0}
            max={23}
            defaultValue={quietStartHour}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="quietEndHour">
            Quiet hours end (0–23)
          </label>
          <input
            id="quietEndHour"
            name="quietEndHour"
            type="number"
            min={0}
            max={23}
            defaultValue={quietEndHour}
            className={input}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">Steps (run in order)</p>
          <button type="button" onClick={addStep} className={btnGhost}>
            Add step
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-text-secondary">No steps yet.</p>
        ) : (
          <ul className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Delay (hours)</label>
                    <input
                      type="number"
                      min={0}
                      value={step.delayHours}
                      onChange={(e) => patch(i, { delayHours: Number(e.target.value) })}
                      className={`${input} w-28`}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Channel</label>
                    <select
                      value={step.channel}
                      onChange={(e) => patch(i, { channel: e.target.value })}
                      className={input}
                    >
                      {CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={() => removeStep(i)} className={btnGhost}>
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-text-secondary">Only score categories:</span>
                  {CATEGORIES.map((cat) => (
                    <label key={cat} className="flex items-center gap-1 text-xs text-text-primary">
                      <input
                        type="checkbox"
                        checked={step.onlyScoreCategories.includes(cat)}
                        onChange={() => toggleCategory(i, cat)}
                      />
                      {cat}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save sequence'}
        </button>
        <Feedback state={state} okMsg="Sequence saved." />
      </div>
    </form>
  );
}

export function EnrollLeadForm({ sequenceId }: { sequenceId: string }) {
  const [state, action, pending] = useActionState(enrollLeadAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="leadId">
          Lead id
        </label>
        <input id="leadId" name="leadId" required className={`${input} w-80`} placeholder="UUID" />
      </div>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Enrolling…' : 'Enrol lead'}
      </button>
      <Feedback state={state} okMsg="Lead enrolled." />
    </form>
  );
}

export function UnenrollForm({
  enrollmentId,
  sequenceId,
}: {
  enrollmentId: string;
  sequenceId: string;
}) {
  const [state, action, pending] = useActionState(unenrollLeadAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <button type="submit" disabled={pending} className={btnGhost}>
        {pending ? '…' : 'Stop'}
      </button>
      {state.error ? <span className="ml-2 text-xs text-terracotta">{state.error}</span> : null}
    </form>
  );
}
