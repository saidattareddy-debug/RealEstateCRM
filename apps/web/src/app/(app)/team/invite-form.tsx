'use client';

import { useActionState } from 'react';
import { createInvitationAction, type ActionState } from './actions';

const initial: ActionState = {};

const ROLE_OPTIONS = [
  ['client_admin', 'Client Admin'],
  ['marketing_manager', 'Marketing Manager'],
  ['sales_manager', 'Sales Manager'],
  ['sales_agent', 'Sales Agent'],
  ['project_maintenance', 'Project Data & Maintenance'],
  ['viewer', 'Viewer'],
] as const;

export function InviteForm() {
  const [state, action, pending] = useActionState(createInvitationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs text-text-secondary">
        Email
        <input
          type="email"
          name="email"
          required
          className="mt-1 w-56 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Role
        <select
          name="roleSlug"
          defaultValue="sales_agent"
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {ROLE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Inviting…' : 'Send invite'}
      </button>
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-success">Invitation created.</p> : null}
    </form>
  );
}
