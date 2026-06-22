'use client';

import { useActionState } from 'react';
import { updatePreferencesAction, type ActionState } from './actions';

const initial: ActionState = {};

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';

export function PreferencesForm({
  emailEnabled,
  pushEnabled,
  quietHoursEnabled,
  mutedKinds,
  kinds,
  kindLabels,
}: {
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietHoursEnabled: boolean;
  mutedKinds: string[];
  kinds: string[];
  kindLabels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(updatePreferencesAction, initial);
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-primary">Channels</legend>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" name="emailEnabled" defaultChecked={emailEnabled} />
          Email (high-priority and urgent only) — simulated in this build
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" name="pushEnabled" defaultChecked={pushEnabled} />
          Push — simulated in this build
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" name="quietHoursEnabled" defaultChecked={quietHoursEnabled} />
          Respect quiet hours (defer external channels overnight; urgent always delivered)
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-primary">Mute notification kinds</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" name={`muted_${k}`} defaultChecked={mutedKinds.includes(k)} />
              {kindLabels[k] ?? k}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
        {state.error ? <p className="text-sm text-terracotta">{state.error}</p> : null}
        {state.ok ? <p className="text-sm text-success">Preferences saved.</p> : null}
      </div>
    </form>
  );
}
