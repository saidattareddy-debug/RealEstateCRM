import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { getSequence, listEnrollments } from '@/lib/followups/service';
import { SequenceEditor, EnrollLeadForm, UnenrollForm } from '../sequences-forms';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/10 text-success',
  completed: 'bg-forest/10 text-forest',
  stopped: 'bg-border/40 text-text-secondary',
};

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'followups.read')) return <PermissionDenied />;

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const sequence = await getSequence(supabase, ctx.activeTenantId!, id);
  if (!sequence) notFound();
  const enrollments = await listEnrollments(supabase, ctx.activeTenantId!, id);
  const canManage = ensurePermission(ctx, 'followups.manage');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/automations/sequences" className="text-xs text-text-secondary hover:underline">
          ← Sequences
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">{sequence.name}</h1>
      </header>

      <div className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-4">
        <p className="text-sm font-semibold text-terracotta">
          Follow-up sends are recorded but never delivered — live-send master switch is off.
        </p>
      </div>

      {canManage ? (
        <Panel title="Configuration">
          <SequenceEditor
            id={sequence.id}
            name={sequence.name}
            enabled={sequence.enabled}
            stopOnReply={sequence.stopOnReply}
            quietStartHour={sequence.quietStartHour}
            quietEndHour={sequence.quietEndHour}
            initialSteps={sequence.steps.map((s) => ({
              delayHours: s.delayHours,
              channel: s.channel,
              templateId: s.templateId,
              onlyScoreCategories: s.onlyScoreCategories,
            }))}
          />
        </Panel>
      ) : (
        <Panel title="Steps">
          {sequence.steps.length === 0 ? (
            <EmptyState title="No steps" />
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-text-primary">
              {sequence.steps.map((s, i) => (
                <li key={i}>
                  After {s.delayHours}h · {s.channel}
                  {s.onlyScoreCategories.length > 0
                    ? ` · only ${s.onlyScoreCategories.join(', ')}`
                    : ''}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {canManage && (
        <Panel title="Enrol a lead">
          <EnrollLeadForm sequenceId={sequence.id} />
        </Panel>
      )}

      <Panel title="Enrolments">
        {enrollments.length === 0 ? (
          <EmptyState title="No enrolments yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-secondary">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Step</th>
                  <th className="py-2 pr-3">Score at enrol</th>
                  <th className="py-2 pr-3">Stop reason</th>
                  {canManage && <th className="py-2 pr-3"></th>}
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono text-xs text-text-primary">
                      {e.leadId.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLE[e.status] ?? 'bg-border/40 text-text-secondary'
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">{e.currentStepIndex}</td>
                    <td className="py-2 pr-3 text-text-secondary">{e.enrolledScoreCategory}</td>
                    <td className="py-2 pr-3 text-text-secondary">{e.stopReason ?? '—'}</td>
                    {canManage && (
                      <td className="py-2 pr-3">
                        {e.status === 'active' ? (
                          <UnenrollForm enrollmentId={e.id} sequenceId={sequence.id} />
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
