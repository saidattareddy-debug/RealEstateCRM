'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setWidgetStatusAction,
  revokeAllWidgetSessionsAction,
  rotateWidgetCredentialAction,
} from './admin-actions';

const btn =
  'rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60';

export function InstallControls({ widgetId, status }: { widgetId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={btn}
          onClick={() =>
            run(() => setWidgetStatusAction(widgetId, status === 'active' ? 'paused' : 'active'))
          }
        >
          {status === 'active' ? 'Pause widget' : 'Resume widget'}
        </button>
        <button
          type="button"
          disabled={pending}
          className={btn}
          onClick={() =>
            run(async () => {
              await revokeAllWidgetSessionsAction(widgetId);
              setMsg('All active visitor sessions revoked.');
            })
          }
        >
          Revoke all sessions
        </button>
        <button
          type="button"
          disabled={pending}
          className={btn}
          onClick={() =>
            start(async () => {
              const res = await rotateWidgetCredentialAction(widgetId);
              if (res.secret) setSecret(res.secret);
              router.refresh();
            })
          }
        >
          Rotate widget credential
        </button>
      </div>
      {msg ? <p className="text-sm text-success">{msg}</p> : null}
      {secret ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-text-primary">
          New installation secret (shown once — copy it now):{' '}
          <code className="break-all font-mono">{secret}</code>
        </p>
      ) : null}
      <p className="text-xs text-text-secondary">
        Individual visitor tokens rotate automatically through the session service; there is
        intentionally no per-visitor rotation button here.
      </p>
    </div>
  );
}
