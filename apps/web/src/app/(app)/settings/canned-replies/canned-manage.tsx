'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import {
  createCannedReply,
  updateCannedReply,
  setCannedReplyActive,
} from '../../inbox/canned-actions';

export interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
}
export interface ProjectRow {
  id: string;
  name: string;
}
export interface CannedReplyRow {
  id: string;
  title: string;
  body: string;
  language: string | null;
  channel: string | null;
  projectId: string | null;
  categoryId: string | null;
  active: boolean;
  usageCount: number;
}

const CHANNELS = ['website_chat', 'whatsapp', 'email', 'voice'] as const;
const ALLOWED_VARIABLES = [
  'lead_name',
  'agent_name',
  'project_name',
  'project_location',
  'site_address',
  'contact_number',
] as const;

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const ghost =
  'rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const field =
  'rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary';

interface FormValues {
  title: string;
  body: string;
  categoryId: string;
  language: string;
  projectId: string;
  channel: string;
}

const emptyForm: FormValues = {
  title: '',
  body: '',
  categoryId: '',
  language: '',
  projectId: '',
  channel: '',
};

export function CannedManage({
  categories,
  replies,
  projects,
}: {
  categories: CategoryRow[];
  replies: CannedReplyRow[];
  projects: ProjectRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);

  // Filters
  const [search, setSearch] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterChannel, setFilterChannel] = useState('');

  const categoryName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? '—') : '—';
  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? '—') : '—';

  const languages = useMemo(
    () =>
      Array.from(
        new Set(replies.map((r) => r.language).filter((l): l is string => Boolean(l))),
      ).sort(),
    [replies],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return replies.filter((r) => {
      if (q && !(r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)))
        return false;
      if (filterLanguage && (r.language ?? '') !== filterLanguage) return false;
      if (filterProject && (r.projectId ?? '') !== filterProject) return false;
      if (filterChannel && (r.channel ?? '') !== filterChannel) return false;
      return true;
    });
  }, [replies, search, filterLanguage, filterProject, filterChannel]);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      onOk?.();
      router.refresh();
    });

  const startEdit = (r: CannedReplyRow) => {
    setEditingId(r.id);
    setForm({
      title: r.title,
      body: r.body,
      categoryId: r.categoryId ?? '',
      language: r.language ?? '',
      projectId: r.projectId ?? '',
      channel: r.channel ?? '',
    });
    setError(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const submit = () => {
    const input = {
      title: form.title,
      body: form.body,
      categoryId: form.categoryId || null,
      language: form.language || null,
      projectId: form.projectId || null,
      channel: form.channel || null,
    };
    run(
      () => (editingId ? updateCannedReply(editingId, input) : createCannedReply(input)),
      resetForm,
    );
  };

  return (
    <div className="space-y-6">
      <Panel title={editingId ? 'Edit reply' : 'New reply'}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Title
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                disabled={pending}
                aria-label="Reply title"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Category
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                disabled={pending}
                aria-label="Reply category"
                className={field}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Language (optional)
              <input
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                disabled={pending}
                placeholder="e.g. en, hi"
                aria-label="Reply language"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Project (optional)
              <select
                value={form.projectId}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                disabled={pending}
                aria-label="Reply project"
                className={field}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Channel (optional)
              <select
                value={form.channel}
                onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                disabled={pending}
                aria-label="Reply channel"
                className={field}
              >
                <option value="">Any channel</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Body
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              disabled={pending}
              rows={4}
              aria-label="Reply body"
              className={field}
            />
          </label>
          <p className="text-xs text-text-secondary">
            Allowed variables (use double braces):{' '}
            {ALLOWED_VARIABLES.map((v) => (
              <code
                key={v}
                className="mr-1 rounded bg-surface-elevated px-1 py-0.5 text-[11px] text-text-primary"
              >{`{{${v}}}`}</code>
            ))}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={submit} disabled={pending} className={btn}>
              {pending ? '…' : editingId ? 'Save changes' : 'Create reply'}
            </button>
            {editingId ? (
              <button type="button" onClick={resetForm} disabled={pending} className={ghost}>
                Cancel
              </button>
            ) : null}
            {error ? <span className="text-sm text-terracotta">{error}</span> : null}
          </div>
        </div>
      </Panel>

      <Panel title="Existing replies">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or body…"
            aria-label="Search replies"
            className={`${field} w-56`}
          />
          <select
            value={filterLanguage}
            onChange={(e) => setFilterLanguage(e.target.value)}
            aria-label="Filter by language"
            className={field}
          >
            <option value="">All languages</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            aria-label="Filter by project"
            className={field}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            aria-label="Filter by channel"
            className={field}
          >
            <option value="">All channels</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No canned replies" hint="Create one above or adjust your filters." />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{r.title}</span>
                    {!r.active ? (
                      <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[11px] text-text-secondary">
                        disabled
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 max-w-xl text-xs text-text-secondary">
                    {r.body}
                  </p>
                  <p className="mt-1 text-[11px] text-text-secondary">
                    {categoryName(r.categoryId)} · {r.language ?? 'any language'} ·{' '}
                    {r.channel ?? 'any channel'} · {projectName(r.projectId)} · used {r.usageCount}×
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    disabled={pending}
                    className={ghost}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => setCannedReplyActive(r.id, !r.active))}
                    disabled={pending}
                    className={ghost}
                  >
                    {r.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
