import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { ScoringTestLabClient } from './test-lab-client';

export const dynamic = 'force-dynamic';

export default async function ScoringTestLabPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'scoring.evaluation.use')) return <PermissionDenied />;

  // RLS-scoped: list this tenant's model versions (label + status) for selection.
  const supabase = await createSupabaseServerClient();
  const { data: versionRows } = await supabase
    .from('scoring_model_versions')
    .select('id, version, status, scoring_models(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  const versions = (versionRows ?? []).map((v) => ({
    id: v.id as string,
    label: `${(v.scoring_models as unknown as { name: string } | null)?.name ?? 'Model'} ${v.version as string} (${v.status as string})`,
    status: v.status as string,
  }));

  // Signal definitions help the operator pick valid keys (synthetic-only lab).
  const { data: signalRows } = await supabase
    .from('scoring_signal_definitions')
    .select('signal_key, value_type, category')
    .order('signal_key', { ascending: true })
    .limit(200);
  const signals = (signalRows ?? []).map((s) => ({
    key: s.signal_key as string,
    valueType: (s.value_type as string | null) ?? 'string',
    category: (s.category as string | null) ?? '',
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Scoring test lab</h1>
        <p className="text-sm text-text-secondary">
          Dry-run the deterministic scoring engine against synthetic observations. Inspect the
          score, classification, every rule component (applied and skipped), missing signals,
          contradictions and the full explanation. Nothing here writes to the database or touches
          any lead.
        </p>
      </div>

      <Panel title="Run a synthetic score">
        <ScoringTestLabClient versions={versions} signals={signals} />
      </Panel>
    </div>
  );
}
