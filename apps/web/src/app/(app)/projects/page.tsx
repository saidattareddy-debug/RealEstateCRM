import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { ProjectCreateForm } from './project-create-form';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  archived: 'Archived',
};

export default async function ProjectsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'projects.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, developer, category, sale_status, approval_status, locality')
    .order('created_at', { ascending: false });

  const canManage = ensurePermission(ctx, 'projects.manage');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Projects</h1>

      {canManage ? (
        <Panel title="Add a project">
          <ProjectCreateForm />
        </Panel>
      ) : null}

      <Panel>
        {!projects || projects.length === 0 ? (
          <EmptyState title="No projects yet" hint="Create your first project to begin." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Locality</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium text-forest hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.developer ? (
                      <span className="ml-2 text-xs text-text-secondary">{p.developer}</span>
                    ) : null}
                  </td>
                  <td className="py-2 capitalize text-text-secondary">{p.category}</td>
                  <td className="py-2 text-text-secondary">{p.locality ?? '—'}</td>
                  <td className="py-2 text-text-secondary">
                    {STATUS_LABEL[p.approval_status as string] ?? p.approval_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
