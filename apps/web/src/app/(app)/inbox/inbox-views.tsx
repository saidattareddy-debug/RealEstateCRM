'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createInboxView,
  deleteInboxView,
  setDefaultInboxView,
  type InboxView,
} from './saved-view-actions';

const chip = 'rounded-full border px-3 py-1 text-xs';
const ghost =
  'rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-elevated disabled:opacity-60';

/**
 * Inbox saved-views bar + tag filter. Views are stored filters only — applying a
 * shared view just sets the URL params; the list query still runs under the
 * viewer's RLS, so a shared manager view opened by an assigned-only agent shows
 * only that agent's already-visible conversations.
 */
export function InboxViews({
  views,
  tags,
  currentFilter,
  currentTag,
  currentUserId,
}: {
  views: InboxView[];
  tags: { id: string; name: string }[];
  currentFilter: string;
  currentTag: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('private');
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });

  const hrefFor = (v: InboxView) => {
    const f = (v.filters.filter as string | undefined) ?? 'all';
    const t = (v.filters.tag as string | undefined) ?? null;
    return `/inbox?filter=${encodeURIComponent(f)}${t ? `&tag=${encodeURIComponent(t)}` : ''}`;
  };

  return (
    <div className="space-y-2">
      {views.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-secondary">Views:</span>
          {views.map((v) => (
            <span key={v.id} className="flex items-center gap-1">
              <Link
                href={hrefFor(v)}
                className={`${chip} border-border text-text-secondary hover:bg-surface-elevated`}
              >
                {v.name}
                {v.isDefault ? ' ★' : ''}
                <span className="ml-1 text-[9px] uppercase opacity-60">{v.scope}</span>
              </Link>
              {v.ownerId === currentUserId ? (
                <>
                  <button
                    type="button"
                    title="Set as my default"
                    className={ghost}
                    disabled={pending}
                    onClick={() => run(() => setDefaultInboxView(v.id, !v.isDefault))}
                  >
                    {v.isDefault ? 'Unset' : 'Default'}
                  </button>
                  <button
                    type="button"
                    title="Delete view"
                    className={ghost}
                    disabled={pending}
                    onClick={() => run(() => deleteInboxView(v.id))}
                  >
                    ✕
                  </button>
                </>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {tags.length > 0 ? (
          <label className="flex items-center gap-1 text-xs text-text-secondary">
            Tag
            <select
              value={currentTag ?? ''}
              aria-label="Filter by tag"
              className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
              onChange={(e) => {
                const t = e.target.value;
                router.push(
                  `/inbox?filter=${encodeURIComponent(currentFilter)}${t ? `&tag=${encodeURIComponent(t)}` : ''}`,
                );
              }}
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <span className="flex items-center gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Save current view as…"
            aria-label="Saved view name"
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="View scope"
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          >
            <option value="private">Private</option>
            <option value="team">Team</option>
            <option value="tenant">Tenant</option>
          </select>
          <button
            type="button"
            className={ghost}
            disabled={pending || !name.trim()}
            onClick={() =>
              run(async () => {
                const res = await createInboxView({
                  name,
                  scope,
                  filter: currentFilter,
                  tag: currentTag ?? undefined,
                });
                if (res.ok) setName('');
                return res;
              })
            }
          >
            Save view
          </button>
        </span>
      </div>
      {error ? <p className="text-xs text-terracotta">{error}</p> : null}
    </div>
  );
}
