'use client';

import { useState, useTransition } from 'react';
import { runTestLab, type TestLabState } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const sel =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

const LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'hinglish'] as const;
// disabled/shadow/copilot only — automatic is never offered (AI cannot send).
const MODES = ['disabled', 'shadow', 'copilot'] as const;

type Project = { id: string; name: string };

export function TestLabClient({ projects }: { projects: Project[] }) {
  const [pending, start] = useTransition();
  const [projectId, setProjectId] = useState('');
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<'auto' | (typeof LANGUAGES)[number]>('auto');
  const [mode, setMode] = useState<(typeof MODES)[number]>('copilot');
  const [syntheticContext, setSyntheticContext] = useState('');
  const [state, setState] = useState<TestLabState | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const run = () => {
    setClientError(null);
    if (!question.trim()) {
      setClientError('Enter a sample question.');
      return;
    }
    start(async () => {
      const result = await runTestLab({
        projectId: projectId || null,
        question,
        language: language === 'auto' ? undefined : language,
        // The action validates mode; only shadow/copilot run, disabled is reported back.
        mode: mode as 'shadow' | 'copilot',
      });
      setState(result);
    });
  };

  const run_ = state?.run;

  return (
    <div className="space-y-5">
      {/* Persistent, prominent test-mode banner. */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium text-warning"
      >
        <span aria-hidden>⚠</span>
        TEST MODE — NOT SENT. This lab only produces an agent-facing draft and trace. It never sends
        a message, changes a conversation or lead, or triggers assignment or automation.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Project (optional)</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Project"
            className={`${sel} w-full`}
            disabled={pending}
          >
            <option value="">No project (tenant-wide knowledge)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            aria-label="Language"
            className={`${sel} w-full`}
            disabled={pending}
          >
            <option value="auto">Auto-detect</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Conversation mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            aria-label="Conversation mode"
            className={`${sel} w-full`}
            disabled={pending}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="block text-xs text-text-secondary">
            Automatic mode is intentionally unavailable — the AI never sends on its own.
          </span>
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Sample question</span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="e.g. What is the price range for 2 BHK units, and when is possession?"
          aria-label="Sample question"
          className={field}
          disabled={pending}
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Synthetic lead context (optional)</span>
        <textarea
          value={syntheticContext}
          onChange={(e) => setSyntheticContext(e.target.value)}
          rows={3}
          placeholder={'budget: 80L\nintent: ready-to-move\npreferred_area: Whitefield'}
          aria-label="Synthetic lead context"
          className={`${field} font-mono`}
          disabled={pending}
        />
        <span className="block text-xs text-text-secondary">
          Synthetic only — never paste a real lead’s name, phone or email. This is for shaping the
          dry-run and is not stored against any lead.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className={btn}>
          {pending ? 'Running…' : 'Run test'}
        </button>
        {clientError ? <span className="text-sm text-terracotta">{clientError}</span> : null}
        {state?.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
      </div>

      {pending ? (
        <p className="text-sm text-text-secondary" role="status" aria-live="polite">
          Running the orchestrator against approved sources…
        </p>
      ) : null}

      {run_ ? <TestLabResult run={run_} /> : null}
    </div>
  );
}

function TestLabResult({ run }: { run: NonNullable<TestLabState['run']> }) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge
          label={run.grounded ? 'Grounded answer' : 'Escalation (not a guess)'}
          tone={run.grounded ? 'success' : 'warning'}
        />
        <Badge label={`grounding: ${run.grounding}`} tone="neutral" />
        {run.escalationCategory ? (
          <Badge
            label={`escalate: ${run.escalationCategory} (${run.escalationPriority})`}
            tone="terracotta"
          />
        ) : null}
        <Badge
          label={run.providerStatus.usingMock ? 'provider: mock' : 'provider: external'}
          tone="neutral"
        />
      </div>

      {run.escalationCategory ? (
        <div className="rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm text-terracotta">
          This question was escalated rather than answered automatically.
        </div>
      ) : null}

      <Section title="Draft answer (agent-facing — not sent)">
        <p className="whitespace-pre-wrap rounded-md border border-border bg-surface-elevated p-3 text-sm text-text-primary">
          {run.draft || '—'}
        </p>
      </Section>

      <Section title="Citations">
        {run.citations.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No citations (escalated or no grounded source).
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
            {run.citations.map((c, i) => (
              <li key={i}>{c.customerSafeReference}</li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Grounding decision">
          <KeyVal k="Decision" v={run.grounding} />
          <KeyVal k="Grounded" v={run.grounded ? 'yes' : 'no'} />
          <KeyVal k="Retrieval sufficiency" v={String(run.sufficiency)} />
        </Section>

        <Section title="Escalation decision">
          <KeyVal k="Category" v={run.escalationCategory ?? 'none'} />
          <KeyVal k="Priority" v={run.escalationPriority} />
        </Section>

        <Section title="Provider / model">
          <KeyVal
            k="Chat external available"
            v={run.providerStatus.chatExternalAvailable ? 'yes' : 'no'}
          />
          <KeyVal
            k="Embedding external available"
            v={run.providerStatus.embeddingExternalAvailable ? 'yes' : 'no'}
          />
          <KeyVal k="Using mock" v={run.providerStatus.usingMock ? 'yes' : 'no'} />
        </Section>

        <Section title="Run trace">
          <KeyVal k="Run id" v={run.runId ?? '—'} />
          <KeyVal k="May send automatically" v={String(run.maySendAutomatically)} />
        </Section>
      </div>

      {run.blockers.length > 0 ? (
        <Section title="Blockers">
          <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
            {run.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-xs text-text-secondary">
        Retrieved chunks, source versions, conflicts, freshness and token/latency detail are
        recorded in the run trace (run id above) for audit. This panel is a dry run — nothing was
        sent and no state changed.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</h3>
      {children}
    </div>
  );
}

function KeyVal({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-text-secondary">{k}</span>
      <span className="text-text-primary">{v}</span>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'terracotta' | 'neutral';
}) {
  const cls =
    tone === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'terracotta'
          ? 'border-terracotta/40 bg-terracotta/10 text-terracotta'
          : 'border-border bg-surface-elevated text-text-secondary';
  return <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{label}</span>;
}
