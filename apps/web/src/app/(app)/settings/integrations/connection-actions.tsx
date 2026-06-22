'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createDraftConnection,
  setSecretRef,
  runMockVerification,
  enableTestMode,
  disableConnection,
} from './actions';

const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';
const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';

const PROVIDERS = [
  'whatsapp_cloud',
  'gmail',
  'imap_email',
  'meta_lead_ads',
  'google_lead_forms',
  'nobroker',
  'ninetynine_acres',
  'housing',
  'magicbricks',
  'generic_portal',
  'generic_webhook',
  'generic_api',
  'manual_test',
] as const;

export function CreateConnectionForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [provider, setProvider] = useState<string>('generic_webhook');
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState('webhook');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createDraftConnection({
        provider: provider as (typeof PROVIDERS)[number],
        displayName,
        integrationKind: kind,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.id) router.push(`/settings/integrations/${res.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={pending}
            className={`mt-1 ${input}`}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Kind
          <input
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={pending}
            maxLength={60}
            className={`mt-1 w-40 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={pending}
            maxLength={120}
            placeholder="e.g. Portal leads (test)"
            className={`mt-1 w-64 ${input}`}
          />
        </label>
        <button
          type="submit"
          disabled={pending || displayName.trim() === ''}
          className={btnPrimary}
        >
          {pending ? 'Creating…' : 'Create draft'}
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
    </form>
  );
}

export function ConnectionLifecycleActions({
  connectionId,
  status,
}: {
  connectionId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'disabled' ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => run(() => runMockVerification(connectionId))}
        >
          Run mock verification
        </button>
      ) : null}
      {status !== 'test' && status !== 'disabled' ? (
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() => run(() => enableTestMode(connectionId))}
        >
          Enable test mode
        </button>
      ) : null}
      {status !== 'disabled' ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => run(() => disableConnection(connectionId))}
        >
          Disable
        </button>
      ) : null}
      {error ? <span className="text-xs text-terracotta">{error}</span> : null}
    </div>
  );
}

export function SecretRefForm({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [credentialType, setCredentialType] = useState('webhook_secret');
  const [secretRef, setSecretRefValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    start(async () => {
      const res = await setSecretRef({ connectionId, credentialType, secretRef });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSecretRefValue('');
      setDone(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-text-secondary">
        Store a <strong>reference</strong> to a secret (an environment-variable name like{' '}
        <code>WHATSAPP_ACCESS_TOKEN</code>). The secret value is never entered here, stored, or
        displayed.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Credential type
          <input
            value={credentialType}
            onChange={(e) => setCredentialType(e.target.value)}
            disabled={pending}
            maxLength={60}
            className={`mt-1 w-44 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Secret reference (env var name)
          <input
            value={secretRef}
            onChange={(e) => setSecretRefValue(e.target.value.toUpperCase())}
            disabled={pending}
            placeholder="WHATSAPP_ACCESS_TOKEN"
            className={`mt-1 w-64 ${input}`}
          />
        </label>
        <button type="submit" disabled={pending || secretRef.trim() === ''} className={btnPrimary}>
          {pending ? 'Saving…' : 'Save reference'}
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {done ? <p className="text-sm text-success">Secret reference saved.</p> : null}
    </form>
  );
}
