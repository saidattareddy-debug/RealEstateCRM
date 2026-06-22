import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { listSequences } from '@/lib/followups/service';
import { CreateSequenceForm } from './sequences-forms';

export const dynamic = 'force-dynamic';

export default async function SequencesPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'followups.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const sequences = await listSequences(supabase, ctx.activeTenantId!);
  const canManage = ensurePermission(ctx, 'followups.manage');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/automations" className="text-xs text-text-secondary hover:underline">
          ← Automations
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Follow-up sequences</h1>
        <p className="text-sm text-text-secondary">
          Score-aware nurture sequences. Steps respect quiet hours and stop on conversion, loss,
          consent revocation, do-not-contact, takeover, or reply.
        </p>
      </header>

      <div className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-4">
        <p className="text-sm font-semibold text-terracotta">
          Follow-up sends are recorded but never delivered — live-send master switch is off.
        </p>
      </div>

      {canManage && (
        <Panel title="New sequence">
          <CreateSequenceForm />
        </Panel>
      )}

      <Panel title="All sequences">
        {sequences.length === 0 ? (
          <EmptyState
            title="No sequences yet"
            hint={canManage ? 'Create one above to get started.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {sequences.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link
                    href={`/automations/sequences/${s.id}`}
                    className="text-sm font-medium text-text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  <p className="text-xs text-text-secondary">
                    {s.stepCount} step{s.stepCount === 1 ? '' : 's'} · {s.activeEnrollments} active
                    enrolment{s.activeEnrollments === 1 ? '' : 's'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-text-secondary'
                  }`}
                >
                  {s.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
