'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  generateCopilotDraft,
  dispositionDraft,
  sendEditedDraft,
  generateAiSummaryPreview,
  type CopilotDraftState,
  type AiSummaryPreviewState,
} from '../../ai/actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const ghost =
  'rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'hinglish'] as const;

type Draft = NonNullable<CopilotDraftState['draft']>;
type Preview = NonNullable<AiSummaryPreviewState['preview']>;

export function Copilot({
  conversationId,
  canCopilot,
}: {
  conversationId: string;
  canCopilot: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<'auto' | (typeof LANGUAGES)[number]>('auto');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  if (!canCopilot) {
    return (
      <p className="text-sm text-text-secondary">
        You do not have permission to use AI copilot in this workspace.
      </p>
    );
  }

  const generate = () => {
    setError(null);
    setNotice(null);
    if (!question.trim()) {
      setError('Enter what the customer is asking so copilot can draft a reply.');
      return;
    }
    start(async () => {
      const res = await generateCopilotDraft({
        conversationId,
        question,
        language: language === 'auto' ? undefined : language,
      });
      if (res.error || !res.draft) {
        setError(res.error ?? 'Could not generate a draft.');
        return;
      }
      setDraft(res.draft);
      setBody(res.draft.body);
    });
  };

  const send = () => {
    if (!draft) return;
    setError(null);
    setNotice(null);
    start(async () => {
      // sendEditedDraft delegates to the human reply path: it runs reply
      // permission / status / consent / DNC / takeover checks itself.
      const res = await sendEditedDraft(conversationId, body);
      if (!res.ok) {
        setError(res.error ?? 'Could not send the reply.');
        return;
      }
      // Record that the (edited) draft was used; never auto-sent.
      await dispositionDraft({ draftId: draft.id, disposition: 'edited' });
      setDraft(null);
      setBody('');
      setNotice('Reply sent and draft marked as edited.');
      router.refresh();
    });
  };

  const disposition = (kind: 'accepted' | 'discarded') => {
    if (!draft) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await dispositionDraft({ draftId: draft.id, disposition: kind });
      if (res.error) {
        setError(res.error);
        return;
      }
      setDraft(null);
      setBody('');
      setNotice(kind === 'accepted' ? 'Draft accepted.' : 'Draft discarded.');
      router.refresh();
    });
  };

  const runPreview = () => {
    setPreviewError(null);
    start(async () => {
      const res = await generateAiSummaryPreview(conversationId);
      if (res.error || !res.preview) {
        setPreviewError(res.error ?? 'Could not generate a preview.');
        return;
      }
      setPreview(res.preview);
    });
  };

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
        AI drafts are agent-facing suggestions. Nothing is sent automatically — sending always
        requires your explicit action and re-runs consent / do-not-contact / status checks.
      </p>

      <div className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">What is the customer asking?</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="e.g. Is the 3 BHK still available and what’s the price?"
            aria-label="Customer question"
            className={field}
            disabled={pending}
          />
        </label>
        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            aria-label="Draft language"
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            disabled={pending}
          >
            <option value="auto">Auto-detect</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" onClick={generate} disabled={pending} className={btn}>
            {pending ? 'Working…' : 'Generate copilot draft'}
          </button>
        </div>
        {error ? <p className="text-sm text-terracotta">{error}</p> : null}
        {notice ? <p className="text-sm text-success">{notice}</p> : null}
      </div>

      {draft ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-elevated p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-text-secondary">
              grounding: {draft.grounding}
            </span>
            {draft.escalationCategory ? (
              <span className="rounded-full border border-terracotta/40 bg-terracotta/10 px-2 py-0.5 font-medium text-terracotta">
                escalate: {draft.escalationCategory}
              </span>
            ) : null}
          </div>

          {draft.escalationCategory ? (
            <p className="rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm text-terracotta">
              ⚠ Copilot escalated this rather than answering. Review carefully before sending —
              this is a suggested action, not a verified customer answer.
            </p>
          ) : null}

          <label className="block space-y-1 text-sm">
            <span className="text-text-secondary">Editable draft</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              aria-label="Editable copilot draft"
              className={field}
              disabled={pending}
            />
          </label>

          {draft.citations.length > 0 ? (
            <div className="text-xs text-text-secondary">
              <p className="font-medium">Citations</p>
              <ul className="list-disc pl-4">
                {draft.citations.map((c, i) => (
                  <li key={i}>{c.customerSafeReference}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={send} disabled={pending || !body.trim()} className={btn}>
              {pending ? 'Sending…' : 'Send edited draft'}
            </button>
            <button
              type="button"
              onClick={() => disposition('accepted')}
              disabled={pending}
              className={ghost}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => disposition('discarded')}
              disabled={pending}
              className={ghost}
            >
              Discard
            </button>
          </div>
          <p className="text-[11px] text-text-secondary">
            “Send edited draft” goes through the normal human reply path (consent / DNC / takeover /
            status enforced). “Accept” and “Discard” only record your disposition — they never send.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3">
        <button type="button" onClick={runPreview} disabled={pending} className={ghost}>
          {pending ? 'Working…' : 'AI summary preview'}
        </button>
        {previewError ? <p className="text-sm text-terracotta">{previewError}</p> : null}
        {preview ? (
          <div className="space-y-1 rounded-md border border-border bg-surface-elevated p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-warning">
              Preview only — not saved
            </p>
            <p className="text-text-primary">{preview.summary}</p>
            {preview.unansweredQuestion ? (
              <p className="text-terracotta">Open question: {preview.unansweredQuestion}</p>
            ) : null}
            <p className="text-text-secondary">Next: {preview.recommendedNextAction}</p>
            <p className="text-[11px] text-text-secondary">
              {preview.messageCount} message(s) · not persisted, no lead fields or scores changed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
