import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { EventStatusBadge, FailureBadge } from '../../settings/integrations/events-ui';

export const dynamic = 'force-dynamic';

const STATUSES = [
  'received',
  'processing',
  'processed',
  'duplicate',
  'failed',
  'dead_letter',
  'rejected',
];

export default async function IntegrationEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.events.read')) return <PermissionDenied />;

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const fProvider = get('provider');
  const fType = get('type');
  const fStatus = get('status');
  const fFrom = get('from');
  const fCorrelation = get('correlation');
  const focusEventId = get('event');

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('external_events')
    .select(
      'id, provider, connection_id, event_type, status, received_at, correlation_id, lead_id, conversation_id',
    )
    .order('received_at', { ascending: false })
    .limit(150);
  if (fProvider) query = query.eq('provider', fProvider);
  if (fType) query = query.eq('event_type', fType);
  if (fStatus) query = query.eq('status', fStatus);
  if (fCorrelation) query = query.eq('correlation_id', fCorrelation);
  if (fFrom) query = query.gte('received_at', fFrom);
  const { data: events } = await query;

  // Failure categories for the listed events.
  const ids = (events ?? []).map((e) => e.id as string);
  const failuresByEvent = new Map<string, string>();
  const replaysByEvent = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: failures }, { data: replays }] = await Promise.all([
      supabase
        .from('external_event_failures')
        .select('event_id, failure_class')
        .in('event_id', ids),
      supabase.from('external_event_replays').select('event_id').in('event_id', ids),
    ]);
    for (const f of failures ?? [])
      failuresByEvent.set(f.event_id as string, f.failure_class as string);
    for (const r of replays ?? []) {
      const eid = r.event_id as string;
      replaysByEvent.set(eid, (replaysByEvent.get(eid) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Integration events</h1>
        <p className="text-sm text-text-secondary">
          Safe event log. Credentials, tokens and raw payloads are never shown.
        </p>
      </div>

      <Panel title="Filters">
        <form method="get" className="flex flex-wrap items-end gap-3 text-xs text-text-secondary">
          <label className="flex flex-col">
            Provider
            <input
              name="provider"
              defaultValue={fProvider ?? ''}
              placeholder="whatsapp_cloud"
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col">
            Event type
            <input
              name="type"
              defaultValue={fType ?? ''}
              placeholder="inbound_message"
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col">
            Status
            <select
              name="status"
              defaultValue={fStatus ?? ''}
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            >
              <option value="">any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            From
            <input
              type="date"
              name="from"
              defaultValue={fFrom ?? ''}
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col">
            Correlation id
            <input
              name="correlation"
              defaultValue={fCorrelation ?? ''}
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
          >
            Apply
          </button>
          <Link href="/integrations/events" className="text-forest hover:underline">
            Reset
          </Link>
        </form>
      </Panel>

      <Panel title="Events">
        {!events || events.length === 0 ? (
          <EmptyState title="No events match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-secondary">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Failure</th>
                  <th className="py-2 pr-3">Created records</th>
                  <th className="py-2 pr-3">Replays</th>
                  <th className="py-2 pr-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const eid = e.id as string;
                  const failure = failuresByEvent.get(eid);
                  const replays = replaysByEvent.get(eid) ?? 0;
                  const created: string[] = [];
                  if (e.lead_id) created.push('lead');
                  if (e.conversation_id) created.push('conversation');
                  return (
                    <tr
                      key={eid}
                      className={`border-b border-border ${
                        focusEventId === eid ? 'bg-surface-elevated' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-medium text-text-primary">
                        {e.event_type as string}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary">{e.provider as string}</td>
                      <td className="py-2 pr-3">
                        <EventStatusBadge status={e.status as string} />
                      </td>
                      <td className="py-2 pr-3">
                        {failure ? <FailureBadge failureClass={failure} /> : '—'}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary">
                        {created.length > 0 ? created.join(', ') : '—'}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary">{replays}</td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">
                        {new Date(e.received_at as string).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
