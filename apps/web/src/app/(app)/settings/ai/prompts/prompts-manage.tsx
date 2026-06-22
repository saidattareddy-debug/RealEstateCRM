'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { createPrompt, createPromptVersion, activatePromptVersion } from '../actions';

export interface PromptVersionRow {
  id: string;
  version: number;
  change_summary: string | null;
  active: boolean;
}

export interface PromptRow {
  id: string;
  key: string;
  description: string | null;
  versions: PromptVersionRow[];
}

const input =
  'mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60';

export function PromptManager({ prompts }: { prompts: PromptRow[] }) {
  return (
    <div className="space-y-8">
      <CreatePromptForm />
      {prompts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-secondary">
          No prompts yet. Create your first prompt above.
        </p>
      ) : (
        <ul className="space-y-4">
          {prompts.map((p) => (
            <PromptCard key={p.id} prompt={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreatePromptForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createPrompt({
        key,
        description: description.trim().length > 0 ? description.trim() : null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setKey('');
      setDescription('');
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-surface-elevated p-3"
    >
      <p className="text-xs font-medium text-text-secondary">Create a prompt</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Key
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            maxLength={120}
            disabled={pending}
            placeholder="e.g. answer.grounded"
            className={cn(input, 'w-56 font-mono')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Description (optional)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            disabled={pending}
            className={cn(input, 'w-64')}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || key.trim().length === 0}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create prompt'}
      </button>
    </form>
  );
}

function PromptCard({ prompt }: { prompt: PromptRow }) {
  const sorted = [...prompt.versions].sort((a, b) => b.version - a.version);
  const activeVersion = sorted.find((v) => v.active);
  return (
    <li className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-text-primary">{prompt.key}</span>
          {activeVersion ? (
            <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
              active v{activeVersion.version}
            </span>
          ) : (
            <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
              no active version
            </span>
          )}
        </div>
        {prompt.description ? (
          <p className="mt-1 text-xs text-text-secondary">{prompt.description}</p>
        ) : null}
      </div>

      <div className="px-3 py-2.5">
        {sorted.length === 0 ? (
          <p className="text-xs text-text-secondary">No versions yet — draft one below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {sorted.map((v) => (
              <VersionRow key={v.id} promptId={prompt.id} version={v} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <NewVersionForm promptId={prompt.id} />
      </div>
    </li>
  );
}

function VersionRow({ promptId, version }: { promptId: string; version: PromptVersionRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function activate() {
    setError(null);
    start(async () => {
      const res = await activatePromptVersion({ promptId, versionId: version.id });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <span className="font-medium text-text-primary">v{version.version}</span>
      {version.change_summary ? (
        <span className="text-xs text-text-secondary">{version.change_summary}</span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {version.active ? (
          <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
            active
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={activate}
            className="rounded-md bg-forest px-2 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-60"
          >
            {pending ? 'Activating…' : 'Activate'}
          </button>
        )}
      </span>
      {error ? <p className="w-full text-xs text-terracotta">{error}</p> : null}
    </li>
  );
}

function NewVersionForm({ promptId }: { promptId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createPromptVersion({
        promptId,
        body,
        changeSummary: changeSummary.trim().length > 0 ? changeSummary.trim() : null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setBody('');
      setChangeSummary('');
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-elevated"
      >
        Draft new version
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="flex flex-col text-xs text-text-secondary">
        Prompt body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={50_000}
          rows={5}
          disabled={pending}
          className={cn(input, 'w-full font-mono')}
        />
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Change summary (optional)
        <input
          type="text"
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          maxLength={500}
          disabled={pending}
          className={cn(input, 'w-full')}
        />
      </label>
      <p className="text-xs text-text-secondary">
        New versions are saved inactive. Activate the version explicitly to make it live.
      </p>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save version'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
