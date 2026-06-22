'use client';

import { useActionState } from 'react';
import { updateBrandingAction, updateOrgSettingsAction, type ActionState } from './actions';

const initial: ActionState = {};

export function BrandingForm({
  primary,
  secondary,
  accent,
}: {
  primary: string;
  secondary: string;
  accent: string;
}) {
  const [state, action, pending] = useActionState(updateBrandingAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <ColorInput name="primary_color" label="Primary" value={primary} />
        <ColorInput name="secondary_color" label="Secondary" value={secondary} />
        <ColorInput name="accent_color" label="Accent" value={accent} />
      </div>
      <Feedback state={state} okMsg="Branding updated." />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save branding'}
      </button>
    </form>
  );
}

export function OrgForm({
  timezone,
  currency,
  retention,
}: {
  timezone: string;
  currency: string;
  retention: number;
}) {
  const [state, action, pending] = useActionState(updateOrgSettingsAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <TextInput name="timezone" label="Timezone" value={timezone} />
        <TextInput name="currency" label="Currency" value={currency} maxLength={3} />
        <TextInput
          name="audit_retention_days"
          label="Audit retention (days)"
          value={String(retention)}
          type="number"
        />
      </div>
      <Feedback state={state} okMsg="Organisation settings updated." />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}

function ColorInput({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        type="text"
        name={name}
        defaultValue={value}
        pattern="#[0-9a-fA-F]{6}"
        className="mt-1 w-28 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
    </label>
  );
}

function TextInput({
  name,
  label,
  value,
  type = 'text',
  maxLength,
}: {
  name: string;
  label: string;
  value: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={value}
        maxLength={maxLength}
        className="mt-1 w-40 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
    </label>
  );
}

function Feedback({ state, okMsg }: { state: ActionState; okMsg: string }) {
  if (state.error) return <p className="text-sm text-terracotta">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-success">{okMsg}</p>;
  return null;
}
