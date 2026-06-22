import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { MatchRuleEditor, type EditorMatchRule, type EditorMatchThresholds } from './rule-editor';

export const dynamic = 'force-dynamic';

export default async function MatchingVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'matching.models.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'matching.models.manage');

  const supabase = await createSupabaseServerClient();
  const { data: version } = await supabase
    .from('matching_model_versions')
    .select(
      'id, model_id, version, status, scale_min, scale_max, thresholds, freshness_window_days, preference_signals, matching_models(name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!version) notFound();

  const { data: ruleRows } = await supabase
    .from('matching_rules')
    .select(
      'id, group_key, kind, operator, signal_key, candidate_field, expected, weight, max_contribution, missing_handling, priority, explanation_template, reason',
    )
    .eq('model_version_id', id)
    .order('priority', { ascending: true });

  const editorRules: EditorMatchRule[] = (ruleRows ?? []).map((r) => ({
    group: r.group_key as string,
    kind: r.kind as string,
    operator: r.operator as string,
    signalKey: r.signal_key as string,
    candidateField: r.candidate_field as string,
    expected: (r.expected as Record<string, unknown>) ?? {},
    weight: Number(r.weight),
    maxContribution: Number(r.max_contribution),
    missingHandling: (r.missing_handling as string) ?? 'zero',
    priority: r.priority as number,
    explanationTemplate: (r.explanation_template as string) ?? '',
    reason: (r.reason as string | null) ?? undefined,
  }));

  const thresholds = (version.thresholds as EditorMatchThresholds | null) ?? {
    excellent: 70,
    good: 50,
    possible: 30,
    weak: 0,
  };
  const modelName =
    (version.matching_models as unknown as { name: string } | null)?.name ?? 'Model';
  const isDraft = version.status === 'draft';
  const prefSignals = (version.preference_signals as string[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/matching" className="text-sm text-forest hover:underline">
          ← Matching models
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">
          {modelName} · {String(version.version)}{' '}
          <span className="text-sm font-normal text-text-secondary">
            ({String(version.status).replace('_', ' ')})
          </span>
        </h1>
        <p className="text-sm text-text-secondary">
          Scale [{String(version.scale_min)}, {String(version.scale_max)}] · freshness window{' '}
          {String(version.freshness_window_days)} days · preference signals:{' '}
          {prefSignals.join(', ') || 'none'}
        </p>
      </div>

      {isDraft && canManage ? (
        <Panel title="Edit draft rules">
          <MatchRuleEditor
            versionId={id}
            initialRules={editorRules}
            initialThresholds={thresholds}
            initialFreshnessWindowDays={version.freshness_window_days as number}
            initialPreferenceSignals={prefSignals}
          />
        </Panel>
      ) : (
        <Panel title="Rules (read-only)">
          <p className="mb-3 text-xs text-text-secondary">
            {version.status === 'active'
              ? 'This version is active and immutable. Clone it to a new draft to make changes.'
              : 'This version is not an editable draft.'}
          </p>
          {editorRules.length === 0 ? (
            <p className="text-sm text-text-secondary">No rules.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Group</th>
                  <th className="pb-2 font-medium">Kind</th>
                  <th className="pb-2 font-medium">Operator</th>
                  <th className="pb-2 font-medium">Signal</th>
                  <th className="pb-2 font-medium">Field</th>
                  <th className="pb-2 font-medium">Weight</th>
                  <th className="pb-2 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {editorRules.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-secondary">{r.group}</td>
                    <td className="py-2 text-text-secondary">{r.kind}</td>
                    <td className="py-2 text-text-secondary">{r.operator}</td>
                    <td className="py-2 text-text-primary">{r.signalKey}</td>
                    <td className="py-2 text-text-secondary">{r.candidateField}</td>
                    <td className="py-2 text-text-secondary">{r.weight}</td>
                    <td className="py-2 text-text-secondary">{r.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
