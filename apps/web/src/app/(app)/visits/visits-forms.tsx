'use client';

import { useActionState } from 'react';
import {
  scheduleVisitAction,
  transitionVisitAction,
  recordOutcomeAction,
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

export function ScheduleVisitForm({
  agents,
  projects,
}: {
  agents: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(scheduleVisitAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="leadId">
            Lead id
          </label>
          <input id="leadId" name="leadId" required className={input} placeholder="UUID" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="agentId">
            Agent
          </label>
          <select id="agentId" name="agentId" required className={input} defaultValue="">
            <option value="" disabled>
              Select agent
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="projectId">
            Project (optional)
          </label>
          <select id="projectId" name="projectId" className={input} defaultValue="">
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="location">
            Location (optional)
          </label>
          <input id="location" name="location" className={input} placeholder="Site address" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="scheduledStart">
            Start
          </label>
          <input
            id="scheduledStart"
            name="scheduledStart"
            type="datetime-local"
            required
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="scheduledEnd">
            End
          </label>
          <input
            id="scheduledEnd"
            name="scheduledEnd"
            type="datetime-local"
            required
            className={input}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="notes">
          Notes (optional)
        </label>
        <textarea id="notes" name="notes" rows={2} className={input} />
      </div>

      {state.conflicts && state.conflicts.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium text-warning">Conflicting bookings:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-secondary">
            {state.conflicts.map((c, i) => (
              <li key={i}>
                {new Date(c.start).toLocaleString()} – {new Date(c.end).toLocaleString()} (
                {c.source})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Scheduling…' : 'Schedule visit'}
        </button>
        <Feedback state={state} okMsg="Visit scheduled." />
      </div>
    </form>
  );
}

export function TransitionButtons({
  visitId,
  transitions,
}: {
  visitId: string;
  transitions: string[];
}) {
  const [state, action, pending] = useActionState(transitionVisitAction, initial);
  if (transitions.length === 0) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="visitId" value={visitId} />
      {transitions.map((t) => (
        <button
          key={t}
          type="submit"
          name="toState"
          value={t}
          disabled={pending}
          className={btnGhost}
        >
          {t.replace('_', ' ')}
        </button>
      ))}
      {state.error ? <span className="text-xs text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function OutcomeForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(recordOutcomeAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="visitId" value={visitId} />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary">Attended</label>
        <select name="attended" className={input} defaultValue="true">
          <option value="true">Attended</option>
          <option value="false">No-show</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary">Interest</label>
        <select name="interestLevel" className={input} defaultValue="">
          <option value="">—</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary">Feedback</label>
        <input name="feedback" className={`${input} w-64`} placeholder="Optional" />
      </div>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Saving…' : 'Record outcome'}
      </button>
      <Feedback state={state} okMsg="Outcome recorded." />
    </form>
  );
}
