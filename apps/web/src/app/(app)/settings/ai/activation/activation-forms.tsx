'use client';

import { useActionState } from 'react';
import {
  requestActivationAction,
  recordApprovalAction,
  applyActivationAction,
  setKillSwitchAction,
  type ActionState,
} from './actions';

const initial: ActionState = {};

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const btnGhost =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60';

function Feedback({ state, okMsg }: { state: ActionState; okMsg: string }) {
  if (state.error) return <p className="text-sm text-terracotta">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-success">{okMsg}</p>;
  return null;
}

export function RequestActivationForm({ channel }: { channel: string }) {
  const [state, action, pending] = useActionState(requestActivationAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="channel" value={channel} />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="requestedMode">
          Requested mode
        </label>
        <select
          id="requestedMode"
          name="requestedMode"
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm"
          defaultValue="shadow"
        >
          <option value="shadow">Shadow — logged for review, nothing sent</option>
          <option value="copilot">Copilot — drafts for agents, nothing sent</option>
          <option value="live_candidate">
            Live candidate — staged for go-live, still suppressed
          </option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="summary">
          Why (summary)
        </label>
        <textarea
          id="summary"
          name="summary"
          rows={2}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm"
          placeholder="Reason for this activation request"
        />
      </div>
      <Feedback state={state} okMsg="Activation request created." />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? 'Submitting…' : 'Request activation'}
      </button>
    </form>
  );
}

export function ApprovalControls({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(recordApprovalAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="role">
          Your sign-off role
        </label>
        <select
          id="role"
          name="role"
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm"
          defaultValue="product"
        >
          <option value="product">Product</option>
          <option value="engineering">Engineering</option>
          <option value="legal">Legal</option>
        </select>
      </div>
      <button type="submit" name="decision" value="approve" disabled={pending} className={btn}>
        Approve
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending} className={btnGhost}>
        Reject
      </button>
      <Feedback state={state} okMsg="Decision recorded." />
    </form>
  );
}

export function ApplyActivationForm({
  requestId,
  disabled,
}: {
  requestId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(applyActivationAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending || disabled}
        className={btn}
        title={disabled ? 'All required roles must approve first' : undefined}
      >
        {pending ? 'Applying…' : 'Apply approved mode'}
      </button>
      <Feedback state={state} okMsg="Mode applied (live sending still off)." />
    </form>
  );
}

export function KillSwitchForm({ channel, active }: { channel: string; active: boolean }) {
  const [state, action, pending] = useActionState(setKillSwitchAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <input
        name="reason"
        placeholder="Reason (optional)"
        className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className={
          active
            ? btnGhost
            : 'rounded-md bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60'
        }
      >
        {pending ? 'Saving…' : active ? 'Clear kill switch' : 'Activate kill switch'}
      </button>
      <Feedback state={state} okMsg="Kill switch updated." />
    </form>
  );
}
