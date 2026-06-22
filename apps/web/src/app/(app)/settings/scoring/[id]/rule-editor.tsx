'use client';

import { useState, useTransition } from 'react';
import { replaceDraftRules } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 font-mono text-xs text-text-primary';

export interface EditorRule {
  group: string;
  signalKey: string;
  operator: string;
  expected?: Record<string, unknown>;
  weight: number;
  maxContribution: number;
  minContribution: number;
  requiredEvidence: boolean;
  priority: number;
  stopProcessing: boolean;
  explanationTemplate: string;
  unknownHandling: string;
  reason?: string;
}

export interface EditorThresholds {
  hot: number;
  warm: number;
  cold: number;
  review: number;
}

/**
 * Pragmatic JSON rule editor for a DRAFT version. The active-version trigger
 * forbids editing active rules; this editor is only rendered for drafts. The
 * server action validates thresholds and rejects prohibited signals.
 */
export function RuleEditor({
  versionId,
  initialRules,
  initialThresholds,
  scaleMin,
  scaleMax,
}: {
  versionId: string;
  initialRules: EditorRule[];
  initialThresholds: EditorThresholds;
  scaleMin: number;
  scaleMax: number;
}) {
  const [rulesText, setRulesText] = useState(JSON.stringify(initialRules, null, 2));
  const [thresholdsText, setThresholdsText] = useState(JSON.stringify(initialThresholds, null, 2));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    setMsg(null);
    let rules: EditorRule[];
    let thresholds: EditorThresholds;
    try {
      rules = JSON.parse(rulesText);
      if (!Array.isArray(rules)) throw new Error('rules must be an array');
    } catch (e) {
      setMsg({ ok: false, text: `Rules JSON invalid: ${(e as Error).message}` });
      return;
    }
    try {
      thresholds = JSON.parse(thresholdsText);
    } catch (e) {
      setMsg({ ok: false, text: `Thresholds JSON invalid: ${(e as Error).message}` });
      return;
    }
    start(async () => {
      const res = await replaceDraftRules({
        versionId,
        thresholds,
        scaleMin,
        scaleMax,
        rules: rules.map((r) => ({
          group: r.group as never,
          signalKey: r.signalKey,
          operator: r.operator as never,
          expected: r.expected,
          weight: Number(r.weight) || 0,
          maxContribution: Number(r.maxContribution) || 0,
          minContribution: Number(r.minContribution) || 0,
          requiredEvidence: Boolean(r.requiredEvidence),
          priority: Number(r.priority) || 100,
          stopProcessing: Boolean(r.stopProcessing),
          explanationTemplate: r.explanationTemplate ?? '',
          unknownHandling: (r.unknownHandling as never) ?? 'zero',
          reason: r.reason,
        })),
      });
      setMsg(
        res.ok
          ? { ok: true, text: 'Saved draft rules.' }
          : { ok: false, text: res.error ?? 'Failed.' },
      );
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">
        Edit this draft’s thresholds and rules as JSON. Prohibited (protected/sensitive) signals are
        rejected server-side. Thresholds must satisfy hot &gt; warm &gt; cold within the [{scaleMin}
        , {scaleMax}] scale.
      </p>
      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Thresholds</span>
        <textarea
          value={thresholdsText}
          onChange={(e) => setThresholdsText(e.target.value)}
          rows={6}
          className={field}
          disabled={pending}
          aria-label="Thresholds JSON"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-text-secondary">Rules</span>
        <textarea
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={18}
          className={field}
          disabled={pending}
          aria-label="Rules JSON"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save draft rules'}
        </button>
        {msg ? (
          <span className={`text-sm ${msg.ok ? 'text-forest' : 'text-terracotta'}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
