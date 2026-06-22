'use client';

import { useActionState } from 'react';
import { createProjectAction, type ActionState } from './actions';

const initial: ActionState = {};

export function ProjectCreateForm() {
  const [state, action, pending] = useActionState(createProjectAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field name="name" label="Project name" required />
      <Field name="developer" label="Developer" />
      <label className="flex flex-col text-xs text-text-secondary">
        Category
        <select
          name="category"
          defaultValue="apartment"
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          <option value="apartment">Apartment</option>
          <option value="villa">Villa</option>
          <option value="plot">Plot</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      <Field name="locality" label="Locality" />
      <Field name="priceMin" label="Price min" type="number" />
      <Field name="priceMax" label="Price max" type="number" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Add project'}
      </button>
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-success">Project created.</p> : null}
    </form>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        type={type}
        name={name}
        required={required}
        className="mt-1 w-40 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
    </label>
  );
}
