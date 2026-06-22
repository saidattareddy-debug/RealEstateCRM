'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { createTag, renameTag, setTagColor, setTagActive } from '../../inbox/tag-actions';

export interface ManagedTag {
  id: string;
  name: string;
  color_token: string;
  active: boolean;
}

const COLOUR_TOKENS = ['forest', 'terracotta', 'warning', 'success', 'muted'] as const;
type ColourToken = (typeof COLOUR_TOKENS)[number];

const SWATCH_CLASS: Record<ColourToken, string> = {
  forest: 'bg-forest',
  terracotta: 'bg-terracotta',
  warning: 'bg-warning',
  success: 'bg-success',
  muted: 'bg-text-secondary',
};

function Swatch({ token }: { token: string }) {
  const cls = SWATCH_CLASS[token as ColourToken] ?? 'bg-text-secondary';
  return <span className={cn('inline-block h-3.5 w-3.5 rounded-full', cls)} aria-hidden />;
}

export function TagManager({ tags }: { tags: ManagedTag[] }) {
  return (
    <div className="space-y-6">
      <CreateTagForm />
      <TagList tags={tags} />
    </div>
  );
}

function CreateTagForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [colour, setColour] = useState<ColourToken>('forest');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTag(name, colour);
      if (res.error) {
        setError(res.error);
        return;
      }
      setName('');
      setColour('forest');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Tag name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={pending}
            placeholder="e.g. Hot lead"
            className="mt-1 w-56 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Colour
          <div className="mt-1 flex items-center gap-2">
            <Swatch token={colour} />
            <select
              value={colour}
              onChange={(e) => setColour(e.target.value as ColourToken)}
              disabled={pending}
              aria-label="Tag colour"
              className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60"
            >
              {COLOUR_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </div>
        </label>

        <button
          type="submit"
          disabled={pending || name.trim().length === 0}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add tag'}
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
    </form>
  );
}

function TagList({ tags }: { tags: ManagedTag[] }) {
  if (tags.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-secondary">
        No tags yet. Create your first tag above.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {tags.map((tag) => (
        <TagRow key={tag.id} tag={tag} />
      ))}
    </ul>
  );
}

function TagRow({ tag }: { tag: ManagedTag }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  return (
    <li
      className={cn('flex flex-wrap items-center gap-3 px-3 py-2.5', !tag.active && 'opacity-60')}
    >
      <Swatch token={tag.color_token} />

      {editing ? (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          disabled={pending}
          aria-label={`Rename tag ${tag.name}`}
          className="w-48 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60"
        />
      ) : (
        <span className="text-sm font-medium text-text-primary">{tag.name}</span>
      )}

      {!tag.active ? (
        <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs font-medium text-text-secondary">
          disabled
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <label className="sr-only" htmlFor={`colour-${tag.id}`}>
          Colour for {tag.name}
        </label>
        <select
          id={`colour-${tag.id}`}
          value={tag.color_token}
          disabled={pending}
          onChange={(e) => run(() => setTagColor(tag.id, e.target.value))}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-text-primary disabled:opacity-60"
        >
          {COLOUR_TOKENS.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>

        {editing ? (
          <>
            <button
              type="button"
              disabled={pending || name.trim().length === 0}
              onClick={() =>
                run(
                  () => renameTag(tag.id, name),
                  () => setEditing(false),
                )
              }
              className="rounded-md bg-forest px-2 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setName(tag.name);
                setEditing(false);
                setError(null);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60"
          >
            Rename
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setTagActive(tag.id, !tag.active))}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium disabled:opacity-60',
            tag.active
              ? 'border border-border text-text-secondary hover:bg-surface-elevated'
              : 'bg-forest text-white hover:bg-forest-deep',
          )}
        >
          {tag.active ? 'Disable' : 'Enable'}
        </button>
      </div>

      {error ? <p className="w-full text-xs text-terracotta">{error}</p> : null}
    </li>
  );
}
