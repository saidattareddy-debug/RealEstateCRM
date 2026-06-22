'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importTemplateFixture, createLocalTemplateDraft } from './actions';

const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';

export function TemplateManager({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [bodyText, setBodyText] = useState('');
  const [variables, setVariables] = useState('');
  const [error, setError] = useState<string | null>(null);

  function run(kind: 'fixture' | 'draft') {
    setError(null);
    const vars = variables
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    start(async () => {
      const res =
        kind === 'fixture'
          ? await importTemplateFixture({
              connectionId,
              name,
              language,
              category: 'utility',
              bodyText,
              variables: vars,
            })
          : await createLocalTemplateDraft({ connectionId, name, language, bodyText });
      if (res.error) {
        setError(res.error);
        return;
      }
      setName('');
      setBodyText('');
      setVariables('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            maxLength={120}
            className={`mt-1 w-48 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Language
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={pending}
            maxLength={10}
            className={`mt-1 w-24 ${input}`}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Variables (comma-separated)
          <input
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            disabled={pending}
            placeholder="name, project"
            className={`mt-1 w-56 ${input}`}
          />
        </label>
      </div>
      <label className="flex flex-col text-xs text-text-secondary">
        Body text
        <textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          disabled={pending}
          rows={2}
          maxLength={1024}
          className={`mt-1 ${input}`}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run('fixture')}
          disabled={pending || name.trim() === '' || bodyText.trim() === ''}
          className={btnPrimary}
        >
          Import fixture (approved)
        </button>
        <button
          type="button"
          onClick={() => run('draft')}
          disabled={pending || name.trim() === '' || bodyText.trim() === ''}
          className={btn}
        >
          Create local draft
        </button>
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
    </div>
  );
}
