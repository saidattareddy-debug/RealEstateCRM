import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { MatchingTestLabClient } from './test-lab-client';

export const dynamic = 'force-dynamic';

export default async function MatchingTestLabPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'matching.evaluation.use')) return <PermissionDenied />;

  // RLS-scoped: list this tenant's matching model versions for selection.
  const supabase = await createSupabaseServerClient();
  const { data: versionRows } = await supabase
    .from('matching_model_versions')
    .select('id, version, status, matching_models(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  const versions = (versionRows ?? []).map((v) => ({
    id: v.id as string,
    label: `${(v.matching_models as unknown as { name: string } | null)?.name ?? 'Model'} ${v.version as string} (${v.status as string})`,
    status: v.status as string,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Matching test lab</h1>
        <p className="text-sm text-text-secondary">
          Dry-run the deterministic matching engine against synthetic preferences, candidate
          projects/configurations/units and synthetic inventory freshness. Inspect eligibility,
          every rule/contribution, exclusions, ranked results and inventory state. Nothing here
          writes to the database or touches any lead, project or inventory.
        </p>
      </div>

      <Panel title="Run a synthetic match">
        <MatchingTestLabClient versions={versions} />
      </Panel>
    </div>
  );
}
