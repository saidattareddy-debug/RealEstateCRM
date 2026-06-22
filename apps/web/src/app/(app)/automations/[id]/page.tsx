import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AUTOMATION_TRIGGERS } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { getAutomation, listAutomationRuns } from '@/lib/automations/service';
import { AutomationEditor, DeleteAutomationForm } from '../automations-forms';

export const dynamic = 'force-dynamic';

const TRIGGER_LABEL: Record<string, string> = {
  lead_created: 'Lead created',
  lead_stage_changed: 'Lead stage changed',
  lead_score_changed: 'Lead score changed',
  conversation_inbound: 'Conversation inbound',
  conversation_idle: 'Conversation idle',
  visit_scheduled: 'Visit scheduled',
  visit_completed: 'Visit completed',
  visit_no_show: 'Visit no-show',
  task_overdue: 'Task overdue',
  time_schedule: 'Time schedule',
};

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'automations.read')) return <PermissionDenied />;

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const automation = await getAutomation(supabase, ctx.activeTenantId!, id);
  if (!automation) notFound();
  const runs = await listAutomationRuns(supabase, ctx.activeTenantId!, id);
  const canManage = ensurePermission(ctx, 'automations.manage');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/automations" className="text-xs text-text-secondary hover:underline">
            ← Automations
          </Link>
          <h1 className="text-xl font-semibold text-text-primary">{automation.name}</h1>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            automation.enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-text-secondary'
          }`}
        >
          {automation.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {canManage ? (
        <Panel title="Configuration">
          <AutomationEditor
            automationId={automation.id}
            name={automation.name}
            trigger={automation.trigger}
            triggers={[...AUTOMATION_TRIGGERS]}
            triggerLabels={TRIGGER_LABEL}
            maxRunsPerLead={automation.maxRunsPerLead}
            initialActions={automation.actions.map((a) => ({
              type: a.action_type,
              params: a.params ?? {},
            }))}
          />
        </Panel>
      ) : (
        <Panel title="Configuration">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-secondary">Trigger</dt>
              <dd className="text-text-primary">
                {TRIGGER_LABEL[automation.trigger] ?? automation.trigger}
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">Actions</dt>
              <dd className="text-text-primary">{automation.actions.length}</dd>
            </div>
          </dl>
        </Panel>
      )}

      <Panel title="Run log">
        {runs.length === 0 ? (
          <EmptyState title="No runs recorded yet" />
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((run) => (
              <li key={run.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-text-primary">
                    {run.matched ? 'Matched' : `Skipped (${run.skippedReason ?? 'unknown'})`}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                {run.actions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {run.actions.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-text-primary">{a.actionType}</span>
                        {a.category === 'customer_send' ? (
                          <span className="rounded-full bg-terracotta/10 px-2 py-0.5 font-medium text-terracotta">
                            suppressed (not sent)
                          </span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              a.status === 'executed'
                                ? 'bg-success/10 text-success'
                                : 'bg-warning/10 text-warning'
                            }`}
                          >
                            {a.status}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canManage && (
        <Panel title="Danger zone">
          <DeleteAutomationForm automationId={automation.id} />
        </Panel>
      )}
    </div>
  );
}
