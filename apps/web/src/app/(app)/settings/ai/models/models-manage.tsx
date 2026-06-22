'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import {
  upsertModelConfig,
  upsertEmbeddingModelConfig,
  type UpsertModelInput,
  type UpsertEmbeddingModelInput,
} from '../actions';

export interface ProviderOption {
  id: string;
  display_name: string;
}

export interface ChatModelRow {
  id: string;
  provider_config_id: string;
  model_name: string;
  max_input_tokens: number;
  max_output_tokens: number;
  temperature: number;
  active: boolean;
}

export interface EmbeddingModelRow {
  id: string;
  provider_config_id: string;
  model_name: string;
  dimensions: number;
  active: boolean;
}

const input =
  'mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60';

export function ModelManager({
  chatProviders,
  embeddingProviders,
  chatModels,
  embeddingModels,
}: {
  chatProviders: ProviderOption[];
  embeddingProviders: ProviderOption[];
  chatModels: ChatModelRow[];
  embeddingModels: EmbeddingModelRow[];
}) {
  return (
    <div className="space-y-8">
      <ChatModelSection providers={chatProviders} models={chatModels} />
      <EmbeddingModelSection providers={embeddingProviders} models={embeddingModels} />
    </div>
  );
}

function nameFor(providers: ProviderOption[], id: string): string {
  return providers.find((p) => p.id === id)?.display_name ?? 'Unknown provider';
}

// ---------------------------------------------------------------------------
// Chat models
// ---------------------------------------------------------------------------

function ChatModelSection({
  providers,
  models,
}: {
  providers: ProviderOption[];
  models: ChatModelRow[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">Chat models</h3>
      {models.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-secondary">
          No chat models yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {models.map((m) => (
            <li
              key={m.id}
              className={cn(
                'flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm',
                !m.active && 'opacity-60',
              )}
            >
              <span className="font-mono font-medium text-text-primary">{m.model_name}</span>
              <span className="text-xs text-text-secondary">
                {nameFor(providers, m.provider_config_id)}
              </span>
              <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                in {m.max_input_tokens.toLocaleString()} / out{' '}
                {m.max_output_tokens.toLocaleString()} · temp {m.temperature}
              </span>
              {!m.active ? (
                <span className="ml-auto rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                  inactive
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {providers.length === 0 ? (
        <p className="text-xs text-text-secondary">
          Add a chat provider first (see Providers) before configuring a chat model.
        </p>
      ) : (
        <ChatModelForm providers={providers} />
      )}
    </div>
  );
}

function ChatModelForm({ providers }: { providers: ProviderOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [modelName, setModelName] = useState('');
  const [maxInput, setMaxInput] = useState('8000');
  const [maxOutput, setMaxOutput] = useState('1500');
  const [temperature, setTemperature] = useState('0.2');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const payload: UpsertModelInput = {
      providerConfigId: providerId,
      modelName,
      maxInputTokens: Number(maxInput),
      maxOutputTokens: Number(maxOutput),
      temperature: Number(temperature),
    };
    start(async () => {
      const res = await upsertModelConfig(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setModelName('');
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-surface-elevated p-3"
    >
      <p className="text-xs font-medium text-text-secondary">Add a chat model</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Provider
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-56')}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Model name
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            maxLength={160}
            disabled={pending}
            placeholder="e.g. mock-chat-v1"
            className={cn(input, 'w-48 font-mono')}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Max input tokens
          <input
            type="number"
            min={1}
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-32')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Max output tokens
          <input
            type="number"
            min={1}
            value={maxOutput}
            onChange={(e) => setMaxOutput(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-32')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Temperature
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-24')}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Model saved.</p> : null}
      <button
        type="submit"
        disabled={pending || modelName.trim().length === 0 || !providerId}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Add chat model'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

function EmbeddingModelSection({
  providers,
  models,
}: {
  providers: ProviderOption[];
  models: EmbeddingModelRow[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">Embedding models</h3>
      {models.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-secondary">
          No embedding models yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {models.map((m) => (
            <li
              key={m.id}
              className={cn(
                'flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm',
                !m.active && 'opacity-60',
              )}
            >
              <span className="font-mono font-medium text-text-primary">{m.model_name}</span>
              <span className="text-xs text-text-secondary">
                {nameFor(providers, m.provider_config_id)}
              </span>
              <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                {m.dimensions} dims
              </span>
              {!m.active ? (
                <span className="ml-auto rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                  inactive
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {providers.length === 0 ? (
        <p className="text-xs text-text-secondary">
          Add an embedding provider first (see Providers) before configuring an embedding model.
        </p>
      ) : (
        <EmbeddingModelForm providers={providers} />
      )}
    </div>
  );
}

function EmbeddingModelForm({ providers }: { providers: ProviderOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [modelName, setModelName] = useState('');
  const [dimensions, setDimensions] = useState('16');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const payload: UpsertEmbeddingModelInput = {
      providerConfigId: providerId,
      modelName,
      dimensions: Number(dimensions),
    };
    start(async () => {
      const res = await upsertEmbeddingModelConfig(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setModelName('');
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-surface-elevated p-3"
    >
      <p className="text-xs font-medium text-text-secondary">Add an embedding model</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Provider
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-56')}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Model name
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            maxLength={160}
            disabled={pending}
            placeholder="e.g. mock-embed-v1"
            className={cn(input, 'w-48 font-mono')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Dimensions
          <input
            type="number"
            min={1}
            max={8192}
            value={dimensions}
            onChange={(e) => setDimensions(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-28')}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Embedding model saved.</p> : null}
      <button
        type="submit"
        disabled={pending || modelName.trim().length === 0 || !providerId}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Add embedding model'}
      </button>
    </form>
  );
}
