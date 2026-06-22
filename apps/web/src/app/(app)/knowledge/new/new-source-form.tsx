'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createKnowledgeSource, type CreateKnowledgeSourceInput } from '../actions';

type Method = CreateKnowledgeSourceInput['method'];

const METHODS: { value: Method; label: string; hint: string }[] = [
  { value: 'manual_text', label: 'Manual text', hint: 'Paste plain text content.' },
  { value: 'markdown', label: 'Markdown', hint: 'Paste markdown; headings become chunks.' },
  { value: 'faq', label: 'FAQ entries', hint: 'Add question / answer pairs.' },
  {
    value: 'project_record',
    label: 'Project record import',
    hint: 'Import approved facts from a project.',
  },
  {
    value: 'document_url',
    label: 'Document reference import',
    hint: 'Reference a URL with pre-extracted text.',
  },
];

const SOURCE_TYPES = [
  'project_overview',
  'approved_faq',
  'brochure',
  'floor_plan',
  'amenity',
  'location',
  'payment_plan',
  'offer',
  'policy',
  'sales_script',
  'legal_disclaimer',
  'manual',
  'imported_facts',
  'general_guidance',
] as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'hinglish', label: 'Hinglish' },
] as const;

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60';

export function NewSourceForm({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [method, setMethod] = useState<Method>('manual_text');
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>('project_overview');
  const [language, setLanguage] = useState('en');
  const [projectId, setProjectId] = useState('');
  const [trustPriority, setTrustPriority] = useState('50');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [recordProjectId, setRecordProjectId] = useState('');
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[]>([
    { question: '', answer: '' },
  ]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Effective/expiry dates are recorded at approval time, not at creation —
    // the createKnowledgeSource action schema intentionally does not accept them.
    const input: CreateKnowledgeSourceInput = {
      method,
      title: title.trim(),
      sourceType,
      language,
      projectId: projectId || null,
      trustPriority: Number(trustPriority),
    };

    if (method === 'manual_text' || method === 'markdown') {
      input.text = body;
    } else if (method === 'faq') {
      input.faqs = faqs
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
        .filter((f) => f.question && f.answer);
    } else if (method === 'project_record') {
      input.recordProjectId = recordProjectId || undefined;
      // The imported record's project is also the source's project scope.
      if (recordProjectId) input.projectId = recordProjectId;
    } else if (method === 'document_url') {
      input.url = url.trim();
      input.extractedText = body;
    }

    startTransition(async () => {
      const res = await createKnowledgeSource(input);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.sourceId) router.push(`/knowledge/${res.sourceId}`);
      else router.push('/knowledge');
    });
  }

  function updateFaq(i: number, field: 'question' | 'answer', value: string) {
    setFaqs((prev) => prev.map((f, idx) => (idx === i ? { ...f, [field]: value } : f)));
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-xs text-text-secondary">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            disabled={pending}
            className={INPUT_CLASS}
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="mt-1 text-[11px] text-text-secondary">
            {METHODS.find((m) => m.value === method)?.hint}
          </span>
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={pending}
            placeholder="e.g. Tower A — payment plan"
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Source type
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as (typeof SOURCE_TYPES)[number])}
            disabled={pending}
            className={INPUT_CLASS}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        {method !== 'project_record' ? (
          <label className="flex flex-col text-xs text-text-secondary">
            Project (optional)
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            >
              <option value="">Global (no project)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex flex-col text-xs text-text-secondary">
          Trust priority (0–100)
          <input
            type="number"
            min={0}
            max={100}
            value={trustPriority}
            onChange={(e) => setTrustPriority(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Effective from
          <input
            type="date"
            value={effectiveAt}
            onChange={(e) => setEffectiveAt(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
          <span className="mt-1 text-[11px] text-text-secondary">Applied when approved.</span>
        </label>

        <label className="flex flex-col text-xs text-text-secondary">
          Expires
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
          <span className="mt-1 text-[11px] text-text-secondary">Applied when approved.</span>
        </label>
      </div>

      {method === 'project_record' ? (
        <label className="flex flex-col text-xs text-text-secondary">
          Project to import
          <select
            value={recordProjectId}
            onChange={(e) => setRecordProjectId(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {method === 'document_url' ? (
        <label className="flex flex-col text-xs text-text-secondary">
          Document URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
            placeholder="https://example.com/brochure.pdf"
            className={INPUT_CLASS}
          />
        </label>
      ) : null}

      {method === 'faq' ? (
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-secondary">FAQ entries</p>
          {faqs.map((f, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <input
                type="text"
                value={f.question}
                onChange={(e) => updateFaq(i, 'question', e.target.value)}
                disabled={pending}
                placeholder="Question"
                className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60"
              />
              <textarea
                value={f.answer}
                onChange={(e) => updateFaq(i, 'answer', e.target.value)}
                disabled={pending}
                placeholder="Answer"
                rows={2}
                className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary disabled:opacity-60"
              />
              {faqs.length > 1 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setFaqs((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-xs font-medium text-terracotta hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
          >
            Add FAQ
          </button>
        </div>
      ) : null}

      {method === 'manual_text' || method === 'markdown' || method === 'document_url' ? (
        <label className="flex flex-col text-xs text-text-secondary">
          {method === 'document_url' ? 'Extracted text' : 'Body'}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={10}
            placeholder={
              method === 'document_url'
                ? 'Paste the text extracted from the document (binary fetch runs in a worker).'
                : 'Content to ingest…'
            }
            className={INPUT_CLASS}
          />
        </label>
      ) : null}

      {error ? <p className="text-sm text-terracotta">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || title.trim().length === 0}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create source'}
        </button>
        <span className="text-xs text-text-secondary">
          The source will await review before it can be approved.
        </span>
      </div>
    </form>
  );
}
