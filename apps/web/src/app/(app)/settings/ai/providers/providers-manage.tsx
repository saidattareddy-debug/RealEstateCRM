'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { upsertProviderConfig, setProviderActive, type UpsertProviderInput } from '../actions';

export interface ProviderRow {
  id: string;
  kind: 'chat' | 'embedding';
  adapter: 'mock' | 'external';
  display_name: string;
  secret_ref: string | null;
  base_url: string | null;
  active: boolean;
  available: boolean;
}

const input =
  'mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60';

export function ProviderManager({ providers }: { providers: ProviderRow[] }) {
  const chat = providers.filter((p) => p.kind === 'chat');
  const embedding = providers.filter((p) => p.kind === 'embedding');
  return (
    <div className="space-y-8">
      <ProviderSection kind="chat" providers={chat} />
      <ProviderSection kind="embedding" providers={embedding} />
    </div>
  );
}

function ProviderSection({
  kind,
  providers,
}: {
  kind: 'chat' | 'embedding';
  providers: ProviderRow[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">
        {kind === 'chat' ? 'Chat providers' : 'Embedding providers'}
      </h3>
      {providers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-secondary">
          No {kind} providers yet. Add one below.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {providers.map((p) => (
            <ProviderRowItem key={p.id} provider={p} />
          ))}
        </ul>
      )}
      <CreateProviderForm kind={kind} />
    </div>
  );
}

function ProviderRowItem({ provider }: { provider: ProviderRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleActive() {
    setError(null);
    start(async () => {
      const res = await setProviderActive({ id: provider.id, active: !provider.active });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 px-3 py-2.5',
        !provider.active && 'opacity-60',
      )}
    >
      <span className="text-sm font-medium text-text-primary">{provider.display_name}</span>
      <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
        {provider.adapter}
      </span>
      {provider.secret_ref ? (
        <span className="rounded-full bg-border/60 px-2 py-0.5 font-mono text-xs text-text-secondary">
          env: {provider.secret_ref}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {provider.available ? (
          <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
            available
          </span>
        ) : (
          <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-medium text-terracotta">
            unavailable
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={toggleActive}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium disabled:opacity-60',
            provider.active
              ? 'border border-border text-text-secondary hover:bg-surface-elevated'
              : 'bg-forest text-white hover:bg-forest-deep',
          )}
        >
          {provider.active ? 'Deactivate' : 'Activate'}
        </button>
      </span>
      {!provider.available && provider.adapter === 'external' ? (
        <p className="w-full text-xs text-terracotta">
          External provider unavailable (no server credential). Set the env var named above on the
          server to enable it.
        </p>
      ) : null}
      {error ? <p className="w-full text-xs text-terracotta">{error}</p> : null}
    </li>
  );
}

function CreateProviderForm({ kind }: { kind: 'chat' | 'embedding' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adapter, setAdapter] = useState<'mock' | 'external'>('mock');
  const [displayName, setDisplayName] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const payload: UpsertProviderInput = {
      kind,
      adapter,
      displayName,
      secretRef: secretRef.trim().length > 0 ? secretRef.trim() : null,
      baseUrl: baseUrl.trim().length > 0 ? baseUrl.trim() : null,
    };
    start(async () => {
      const res = await upsertProviderConfig(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDisplayName('');
      setSecretRef('');
      setBaseUrl('');
      setAdapter('mock');
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-surface-elevated p-3"
    >
      <p className="text-xs font-medium text-text-secondary">Add a {kind} provider</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Display name
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            disabled={pending}
            placeholder={kind === 'chat' ? 'e.g. Production chat' : 'e.g. Production embeddings'}
            className={cn(input, 'w-56')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Adapter
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value as 'mock' | 'external')}
            disabled={pending}
            className={cn(input, 'w-40')}
          >
            <option value="mock">mock (deterministic)</option>
            <option value="external">external</option>
          </select>
        </label>
      </div>

      {adapter === 'external' ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-text-secondary">
            Secret env-var name
            <input
              type="text"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value.toUpperCase())}
              maxLength={128}
              disabled={pending}
              placeholder="e.g. OPENAI_API_KEY"
              className={cn(input, 'w-56 font-mono')}
            />
          </label>
          <label className="flex flex-col text-xs text-text-secondary">
            Base URL (optional)
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              maxLength={2048}
              disabled={pending}
              placeholder="https://api.example.com"
              className={cn(input, 'w-64')}
            />
          </label>
        </div>
      ) : null}

      {adapter === 'external' ? (
        <p className="text-xs text-text-secondary">
          Enter only the NAME of a server environment variable — never paste a secret value here.
          The provider stays unavailable until that env var is set on the server.
        </p>
      ) : null}

      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Provider saved.</p> : null}

      <button
        type="submit"
        disabled={pending || displayName.trim().length === 0}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Add provider'}
      </button>
    </form>
  );
}
