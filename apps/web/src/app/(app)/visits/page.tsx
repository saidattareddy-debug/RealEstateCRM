import {
  canTransitionVisit,
  isTerminalVisitState,
  VISIT_STATES,
  type VisitState,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { listVisits, type VisitView } from '@/lib/visits/service';
import { ScheduleVisitForm, TransitionButtons, OutcomeForm } from './visits-forms';

export const dynamic = 'force-dynamic';

const STATE_STYLE: Record<string, string> = {
  requested: 'bg-border/40 text-text-secondary',
  scheduled: 'bg-forest/10 text-forest',
  confirmed: 'bg-success/10 text-success',
  in_progress: 'bg-champagne/20 text-forest-deep',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-border/40 text-text-secondary',
  no_show: 'bg-warning/10 text-warning',
  rescheduled: 'bg-champagne/20 text-forest-deep',
};

function dayKey(iso: string | null): string {
  if (!iso) return 'Unscheduled';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default async function VisitsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'sitevisits.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const visits = await listVisits(supabase, ctx.activeTenantId!);
  const canManage = ensurePermission(ctx, 'sitevisits.manage');

  let agents: { id: string; name: string }[] = [];
  let projects: { id: string; name: string }[] = [];
  if (canManage) {
    const [{ data: members }, { data: projectRows }] = await Promise.all([
      supabase
        .from('memberships')
        .select('profile_id, profiles(full_name), roles!inner(slug)')
        .in('roles.slug', ['sales_agent', 'sales_manager']),
      supabase
        .from('projects')
        .select('id, name')
        .eq('tenant_id', ctx.activeTenantId!)
        .order('name', { ascending: true })
        .limit(200),
    ]);
    const seen = new Set<string>();
    agents = (members ?? [])
      .map((m) => ({
        id: m.profile_id as string,
        name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? 'Agent',
      }))
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    projects = (projectRows ?? []).map((p) => ({ id: p.id as string, name: p.name as string }));
  }

  // Group by day for a simple schedule view.
  const groups = new Map<string, VisitView[]>();
  for (const v of visits) {
    const key = dayKey(v.scheduledStart);
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Site visits</h1>
        <p className="text-sm text-text-secondary">
          Schedule and track property visits. Double-booking is prevented per agent. Calendar sync
          is simulation-only in this build.
        </p>
      </header>

      {canManage && (
        <Panel title="Schedule a visit">
          <ScheduleVisitForm agents={agents} projects={projects} />
        </Panel>
      )}

      {visits.length === 0 ? (
        <Panel title="Schedule">
          <EmptyState title="No visits yet" hint={canManage ? 'Schedule one above.' : undefined} />
        </Panel>
      ) : (
        [...groups.entries()].map(([day, dayVisits]) => (
          <Panel key={day} title={day}>
            <ul className="space-y-4">
              {dayVisits.map((v) => {
                const transitions = VISIT_STATES.filter((s) => canTransitionVisit(v.state, s));
                const canRecordOutcome =
                  v.state === 'in_progress' || v.state === 'confirmed' || v.state === 'scheduled';
                return (
                  <li key={v.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {v.scheduledStart
                            ? `${new Date(v.scheduledStart).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })} – ${
                                v.scheduledEnd
                                  ? new Date(v.scheduledEnd).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''
                              }`
                            : 'Unscheduled'}
                        </p>
                        <p className="text-xs text-text-secondary">
                          Lead {v.leadId.slice(0, 8)}…{v.location ? ` · ${v.location}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATE_STYLE[v.state] ?? 'bg-border/40 text-text-secondary'
                        }`}
                      >
                        {v.state.replace('_', ' ')}
                      </span>
                    </div>

                    {canManage && !isTerminalVisitState(v.state as VisitState) && (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <TransitionButtons visitId={v.id} transitions={transitions} />
                        {canRecordOutcome && <OutcomeForm visitId={v.id} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
