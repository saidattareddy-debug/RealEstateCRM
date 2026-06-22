import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { ResolveButtons } from '../lead-forms';

export const dynamic = 'force-dynamic';

export default async function DuplicatesPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'leads.merge')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: dups } = await supabase
    .from('lead_duplicates')
    .select(
      'id, confidence, signals, is_broker_conflict, lead:leads!lead_duplicates_lead_id_fkey(full_name, primary_phone_national), dup:leads!lead_duplicates_duplicate_lead_id_fkey(full_name, primary_phone_national)',
    )
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Duplicate review</h1>
      <p className="text-sm text-text-secondary">
        Possible duplicates are flagged on ingestion and never merged silently. Merging keeps the
        older lead and is reversible (a snapshot is recorded).
      </p>
      <Panel>
        {!dups || dups.length === 0 ? (
          <EmptyState title="No open duplicates" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Incoming lead</th>
                <th className="pb-2 font-medium">Matches</th>
                <th className="pb-2 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Signals</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {dups.map((d) => {
                const lead = d.lead as unknown as {
                  full_name: string | null;
                  primary_phone_national: string | null;
                } | null;
                const dup = d.dup as unknown as {
                  full_name: string | null;
                  primary_phone_national: string | null;
                } | null;
                return (
                  <tr key={d.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-primary">
                      {lead?.full_name ?? '—'}
                      <span className="ml-1 text-xs text-text-secondary">
                        {lead?.primary_phone_national}
                      </span>
                    </td>
                    <td className="py-2 text-text-primary">
                      {dup?.full_name ?? '—'}
                      <span className="ml-1 text-xs text-text-secondary">
                        {dup?.primary_phone_national}
                      </span>
                    </td>
                    <td className="py-2 capitalize text-text-secondary">
                      {d.confidence}
                      {d.is_broker_conflict ? (
                        <span className="ml-2 rounded bg-terracotta/15 px-2 py-0.5 text-xs text-terracotta">
                          broker conflict
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs text-text-secondary">
                      {Array.isArray(d.signals) ? (d.signals as string[]).join(', ') : ''}
                    </td>
                    <td className="py-2 text-right">
                      <ResolveButtons
                        duplicateId={d.id as string}
                        broker={Boolean(d.is_broker_conflict)}
                      />
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
