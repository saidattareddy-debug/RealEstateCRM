import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PermissionDenied, EmptyState } from '@/components/ui/states';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'leads.read.assigned')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const [{ data: stages }, { data: leads }] = await Promise.all([
    supabase.from('pipeline_stages').select('id, name, sort_order').order('sort_order'),
    supabase
      .from('leads')
      .select('id, full_name, stage_id, primary_phone_national')
      .is('deleted_at', null)
      .limit(500),
  ]);

  const byStage = new Map<
    string,
    { id: string; full_name: string | null; primary_phone_national: string | null }[]
  >();
  for (const l of leads ?? []) {
    const key = (l.stage_id as string | null) ?? 'none';
    const arr = byStage.get(key) ?? [];
    arr.push({
      id: l.id as string,
      full_name: (l.full_name as string | null) ?? null,
      primary_phone_national: (l.primary_phone_national as string | null) ?? null,
    });
    byStage.set(key, arr);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Pipeline</h1>
      {!stages || stages.length === 0 ? (
        <EmptyState title="No pipeline configured" />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((s) => {
            const items = byStage.get(s.id as string) ?? [];
            return (
              <div key={s.id} className="w-64 shrink-0 rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-sm font-semibold text-text-primary">{s.name}</span>
                  <span className="rounded bg-surface-elevated px-2 text-xs text-text-secondary">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2 p-2">
                  {items.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-text-secondary">No leads</p>
                  ) : (
                    items.map((l) => (
                      <Link
                        key={l.id}
                        href={`/leads/${l.id}`}
                        className="block rounded-md border border-border bg-surface-elevated px-3 py-2 hover:border-forest"
                      >
                        <p className="text-sm font-medium text-text-primary">
                          {l.full_name ?? 'Unnamed'}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {l.primary_phone_national ?? ''}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
