import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { RuleEditor, type EditorRule, type EditorThresholds } from './rule-editor';

export const dynamic = 'force-dynamic';

export default async function ScoringVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'scoring.models.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'scoring.models.manage');

  const supabase = await createSupabaseServerClient();
  const { data: version } = await supabase
    .from('scoring_model_versions')
    .select(
      'id, model_id, version, status, scale_min, scale_max, thresholds, qualification_signals, scoring_models(name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!version) notFound();

  const { data: ruleRows } = await supabase
    .from('scoring_rules')
    .select(
      'id, group_key, signal_key, operator, expected, weight, max_contribution, min_contribution, required_evidence, priority, stop_processing, explanation_template, unknown_handling, reason',
    )
    .eq('model_version_id', id)
    .order('priority', { ascending: true });

  const editorRules: EditorRule[] = (ruleRows ?? []).map((r) => ({
    group: r.group_key as string,
    signalKey: r.signal_key as string,
    operator: r.operator as string,
    expected: (r.expected as Record<string, unknown>) ?? {},
    weight: Number(r.weight),
    maxContribution: Number(r.max_contribution),
    minContribution: Number(r.min_contribution),
    requiredEvidence: Boolean(r.required_evidence),
    priority: r.priority as number,
    stopProcessing: Boolean(r.stop_processing),
    explanationTemplate: (r.explanation_template as string) ?? '',
    unknownHandling: (r.unknown_handling as string) ?? 'zero',
    reason: (r.reason as string | null) ?? undefined,
  }));

  const thresholds = (version.thresholds as EditorThresholds | null) ?? {
    hot: 70,
    warm: 40,
    cold: 0,
    review: 0,
  };
  const modelName = (version.scoring_models as unknown as { name: string } | null)?.name ?? 'Model';
  const isDraft = version.status === 'draft';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/scoring" className="text-sm text-forest hover:underline">
          ← Scoring models
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">
          {modelName} · {String(version.version)}{' '}
          <span className="text-sm font-normal text-text-secondary">
            ({String(version.status).replace('_', ' ')})
          </span>
        </h1>
        <p className="text-sm text-text-secondary">
          Scale [{String(version.scale_min)}, {String(version.scale_max)}] · qualification signals:{' '}
          {(version.qualification_signals as string[] | null)?.join(', ') || 'none'}
        </p>
      </div>

      {isDraft && canManage ? (
        <Panel title="Edit draft rules">
          <RuleEditor
            versionId={id}
            initialRules={editorRules}
            initialThresholds={thresholds}
            scaleMin={version.scale_min as number}
            scaleMax={version.scale_max as number}
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
                  <th className="pb-2 font-medium">Signal</th>
                  <th className="pb-2 font-medium">Operator</th>
                  <th className="pb-2 font-medium">Weight</th>
                  <th className="pb-2 font-medium">Max</th>
                  <th className="pb-2 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {editorRules.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-secondary">{r.group}</td>
                    <td className="py-2 text-text-primary">{r.signalKey}</td>
                    <td className="py-2 text-text-secondary">{r.operator}</td>
                    <td className="py-2 text-text-secondary">{r.weight}</td>
                    <td className="py-2 text-text-secondary">{r.maxContribution}</td>
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
