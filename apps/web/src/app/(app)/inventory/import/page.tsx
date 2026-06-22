import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { ImportClient } from './import-client';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'inventory.import')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase.from('projects').select('id, name').order('name');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Import inventory (CSV)</h1>
      {!projects || projects.length === 0 ? (
        <EmptyState title="Create a project first" hint="Inventory is imported into a project." />
      ) : (
        <ImportClient
          projects={projects.map((p) => ({ id: p.id as string, name: p.name as string }))}
        />
      )}
    </div>
  );
}
