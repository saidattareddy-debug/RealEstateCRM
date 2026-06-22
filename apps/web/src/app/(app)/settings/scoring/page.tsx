import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { VersionActions } from './scoring-admin-client';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  active: 'border-success/40 bg-success/10 text-success',
  draft: 'border-border bg-surface-elevated text-text-secondary',
  pending_approval: 'border-warning/40 bg-warning/10 text-warning',
  retired: 'border-border bg-surface-elevated text-text-secondary',
};

export default async function ScoringSettingsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'scoring.models.read')) return <PermissionDenied />;

  const canManage = ensurePermission(ctx, 'scoring.models.manage');
  const canApprove = ensurePermission(ctx, 'scoring.models.approve');

  const supabase = await createSupabaseServerClient();
  const { data: models } = await supabase
    .from('scoring_models')
    .select('id, key, name, description')
    .order('created_at', { ascending: true });

  const { data: versions } = await supabase
    .from('scoring_model_versions')
    .select('id, model_id, version, status, activated_at, created_at')
    .order('created_at', { ascending: false });

  const versionsByModel = new Map<string, NonNullable<typeof versions>>();
  for (const v of versions ?? []) {
    const arr = versionsByModel.get(v.model_id as string) ?? [];
    arr.push(v);
    versionsByModel.set(v.model_id as string, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Lead scoring models</h1>
          <p className="text-sm text-text-secondary">
            Deterministic, versioned scoring. Only one version per model is active. Editing an
            active version is not allowed — create a new draft, edit its rules, then activate it.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/settings/scoring/signals" className="text-forest hover:underline">
            Signals →
          </Link>
          <Link href="/scoring/test-lab" className="text-forest hover:underline">
            Test lab →
          </Link>
        </div>
      </div>

      {!models || models.length === 0 ? (
        <EmptyState title="No scoring models" hint="A default model is seeded per tenant." />
      ) : (
        models.map((m) => {
          const vs = versionsByModel.get(m.id as string) ?? [];
          return (
            <Panel key={m.id as string} title={`${m.name} (${m.key})`}>
              {m.description ? (
                <p className="mb-3 text-sm text-text-secondary">{m.description}</p>
              ) : null}
              {vs.length === 0 ? (
                <EmptyState title="No versions" />
              ) : (
                <ul className="space-y-3">
                  {vs.map((v) => (
                    <li
                      key={v.id as string}
                      className="space-y-2 rounded-md border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/settings/scoring/${v.id}`}
                            className="font-medium text-forest hover:underline"
                          >
                            {String(v.version)}
                          </Link>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              STATUS_TONE[v.status as string] ?? STATUS_TONE.draft
                            }`}
                          >
                            {String(v.status).replace('_', ' ')}
                          </span>
                          {v.activated_at ? (
                            <span className="text-xs text-text-secondary">
                              activated {new Date(v.activated_at as string).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <VersionActions
                        versionId={v.id as string}
                        modelId={m.id as string}
                        status={v.status as string}
                        caps={{ canManage, canApprove }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
