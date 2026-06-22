import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { CreateTaskForm, TaskDoneButton } from './task-forms';

export const dynamic = 'force-dynamic';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'tasks.manage')) return <PermissionDenied />;
  const sp = await searchParams;
  const view = sp.view ?? 'mine';

  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('tasks')
    .select('id, title, due_at, status, lead_id, assignee_id')
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false });
  if (view === 'mine') q = q.eq('assignee_id', ctx.userId);
  const { data: tasks } = await q;

  const now = Date.now();
  const filtered =
    view === 'overdue'
      ? (tasks ?? []).filter((t) => t.due_at && new Date(t.due_at as string).getTime() < now)
      : (tasks ?? []);

  const tabs = [
    ['mine', 'My tasks'],
    ['team', 'Team tasks'],
    ['overdue', 'Overdue'],
  ] as const;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Tasks</h1>

      <Panel title="Add a task">
        <CreateTaskForm />
      </Panel>

      <div className="flex gap-2 text-sm">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/tasks?view=${key}`}
            className={`rounded-md px-3 py-1 ${view === key ? 'bg-forest text-white' : 'text-text-secondary hover:bg-surface-elevated'}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Panel>
        {filtered.length === 0 ? (
          <EmptyState title="No open tasks" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Task</th>
                <th className="pb-2 font-medium">Due</th>
                <th className="pb-2 font-medium">Lead</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const overdue = t.due_at && new Date(t.due_at as string).getTime() < now;
                return (
                  <tr key={t.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">{t.title}</td>
                    <td className={`py-2 ${overdue ? 'text-terracotta' : 'text-text-secondary'}`}>
                      {t.due_at ? new Date(t.due_at as string).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 text-text-secondary">
                      {t.lead_id ? (
                        <Link href={`/leads/${t.lead_id}`} className="text-forest hover:underline">
                          view lead
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <TaskDoneButton taskId={t.id as string} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
