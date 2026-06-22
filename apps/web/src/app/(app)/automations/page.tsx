import Link from 'next/link';
import { AUTOMATION_TRIGGERS } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { listAutomations } from '@/lib/automations/service';
import { AutomationToggle, CreateAutomationForm } from './automations-forms';

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

export default async function AutomationsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'automations.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const automations = await listAutomations(supabase, ctx.activeTenantId!);
  const canManage = ensurePermission(ctx, 'automations.manage');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Automations</h1>
        <p className="text-sm text-text-secondary">
          Workflow automations run internal actions (tasks, stage moves, assignments, tags, notes,
          notifications, sequence enrolments) when a trigger fires.
        </p>
      </header>

      <div className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-4">
        <p className="text-sm font-semibold text-terracotta">
          Customer messaging is never sent automatically.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Send actions (WhatsApp / email) are recorded as{' '}
          <span className="font-medium">suppressed (not sent)</span> — the live-send master switch
          is off. Internal actions do run.
        </p>
      </div>

      {canManage && (
        <Panel title="New automation">
          <CreateAutomationForm triggers={[...AUTOMATION_TRIGGERS]} triggerLabels={TRIGGER_LABEL} />
        </Panel>
      )}

      <Panel title="All automations">
        {automations.length === 0 ? (
          <EmptyState
            title="No automations yet"
            hint={canManage ? 'Create one above to get started.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {automations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/automations/${a.id}`}
                    className="text-sm font-medium text-text-primary hover:underline"
                  >
                    {a.name}
                  </Link>
                  <p className="text-xs text-text-secondary">
                    {TRIGGER_LABEL[a.trigger] ?? a.trigger}
                    {a.lastRunAt
                      ? ` · last run ${new Date(a.lastRunAt).toLocaleString()}`
                      : ' · never run'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-text-secondary'
                    }`}
                  >
                    {a.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  {canManage && <AutomationToggle automationId={a.id} enabled={a.enabled} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
