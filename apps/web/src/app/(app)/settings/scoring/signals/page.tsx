import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { SignalForm } from './signal-form';

export const dynamic = 'force-dynamic';

export default async function ScoringSignalsPage() {
  const ctx = await getAppContext();
  // Reading signals is part of model config; managing them needs signals.manage.
  if (!ensurePermission(ctx, 'scoring.models.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'scoring.signals.manage');

  const supabase = await createSupabaseServerClient();
  const { data: signals } = await supabase
    .from('scoring_signal_definitions')
    .select('id, signal_key, category, value_type, description')
    .order('signal_key', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/scoring" className="text-sm text-forest hover:underline">
          ← Scoring models
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Scoring signals</h1>
        <p className="text-sm text-text-secondary">
          The catalogue of signals rules may reference. Protected/sensitive traits can never be
          defined as scoring inputs.
        </p>
      </div>

      {canManage ? (
        <Panel title="Add a signal">
          <SignalForm />
        </Panel>
      ) : null}

      <Panel title="Defined signals">
        {!signals || signals.length === 0 ? (
          <EmptyState title="No signals defined" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Key</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id as string} className="border-b border-border/60 last:border-0">
                  <td className="py-2 font-medium text-text-primary">{s.signal_key as string}</td>
                  <td className="py-2 text-text-secondary">{s.category as string}</td>
                  <td className="py-2 text-text-secondary">{s.value_type as string}</td>
                  <td className="py-2 text-text-secondary">
                    {(s.description as string | null) ?? '—'}
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
