import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { InviteForm } from './invite-form';

export default async function TeamPage() {
  const ctx = await getAppContext();

  if (!ensurePermission(ctx, 'team.performance.read')) {
    return <PermissionDenied />;
  }

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from('memberships')
    .select('status, profiles(full_name, email), roles(name)')
    .eq('tenant_id', ctx.activeTenantId!)
    .eq('status', 'active');

  const members = (rows ?? []).map((r) => {
    const p = r.profiles as unknown as { full_name: string | null; email: string } | null;
    const role = r.roles as unknown as { name: string } | null;
    return {
      name: p?.full_name ?? '—',
      email: p?.email ?? '—',
      role: role?.name ?? '—',
    };
  });

  const canInvite = ensurePermission(ctx, 'users.invite');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Team</h1>
      {canInvite ? (
        <Panel title="Invite a teammate">
          <InviteForm />
        </Panel>
      ) : null}
      <Panel>
        {members.length === 0 ? (
          <EmptyState title="No team members yet" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email} className="border-b border-border/60 last:border-0">
                  <td className="py-2 text-text-primary">{m.name}</td>
                  <td className="py-2 text-text-secondary">{m.email}</td>
                  <td className="py-2 text-text-secondary">{m.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
