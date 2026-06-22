'use client';

import { useState, useTransition } from 'react';
import { replaceDraftMatchRules } from '../actions';

const btn =
  'rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60';
const field =
  'w-full rounded-md border border-border bg-surface-elevated p-2 font-mono text-xs text-text-primary';
const input =
  'w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-primary';

export interface EditorMatchRule {
  group: string;
  kind: string;
  operator: string;
  signalKey: string;
  candidateField: string;
  expected?: Record<string, unknown>;
  weight: number;
  maxContribution: number;
  missingHandling: string;
  priority: number;
  explanationTemplate: string;
  reason?: string;
}

export interface EditorMatchThresholds {
  excellent: number;
  good: number;
  possible: number;
  weak: number;
}

/**
 * Pragmatic JSON rule editor for a DRAFT version. The active-version trigger
 * forbids editing active rules; this editor is only rendered for drafts. The
 * server action validates thresholds and rejects prohibited signals/fields.
 */
export function MatchRuleEditor({
  versionId,
  initialRules,
  initialThresholds,
  initialFreshnessWindowDays,
  initialPreferenceSignals,
}: {
  versionId: string;
  initialRules: EditorMatchRule[];
  initialThresholds: EditorMatchThresholds;
  initialFreshnessWindowDays: number;
  initialPreferenceSignals: string[];
}) {
  const [rulesText, setRulesText] = useState(JSON.stringify(initialRules, null, 2));
  const [thresholdsText, setThresholdsText] = useState(JSON.stringify(initialThresholds, null, 2));
  const [freshness, setFreshness] = useState(String(initialFreshnessWindowDays));
  const [prefSignals, setPrefSignals] = useState(initialPreferenceSignals.join(', '));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    setMsg(null);
    let rules: EditorMatchRule[];
    let thresholds: EditorMatchThresholds;
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
      const res = await replaceDraftMatchRules({
        versionId,
        thresholds,
        freshnessWindowDays: Number(freshness) || 0,
        preferenceSignals: prefSignals
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        rules: rules.map((r) => ({
          group: r.group as never,
          kind: (r.kind as never) ?? 'soft',
          operator: r.operator as never,
          signalKey: r.signalKey,
          candidateField: r.candidateField,
          expected: r.expected,
          weight: Number(r.weight) || 0,
          maxContribution: Number(r.maxContribution) || 0,
          missingHandling: (r.missingHandling as never) ?? 'zero',
          priority: Number(r.priority) || 100,
          explanationTemplate: r.explanationTemplate ?? '',
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
        Edit this draft’s thresholds, freshness policy, preference signals and rules. Prohibited
        (protected/sensitive) signals or candidate fields are rejected server-side. Each rule needs
        a `signalKey` (lead preference) and a `candidateField` (project/unit fact).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Freshness window (days)</span>
          <input
            value={freshness}
            onChange={(e) => setFreshness(e.target.value)}
            inputMode="numeric"
            className={input}
            disabled={pending}
            aria-label="Freshness window days"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">Preference signals (csv)</span>
          <input
            value={prefSignals}
            onChange={(e) => setPrefSignals(e.target.value)}
            className={input}
            disabled={pending}
            aria-label="Preference signals"
          />
        </label>
      </div>
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
