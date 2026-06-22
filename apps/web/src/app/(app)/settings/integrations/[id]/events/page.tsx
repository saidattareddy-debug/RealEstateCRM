import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner } from '../../ui';
import { EventStatusBadge } from '../../events-ui';

export const dynamic = 'force-dynamic';

export default async function ConnectionEventsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.events.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: events } = await supabase
    .from('external_events')
    .select('id, event_type, status, provider, received_at, correlation_id')
    .eq('connection_id', id)
    .order('received_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/settings/integrations/${id}`} className="text-sm text-forest hover:underline">
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Connection events</h1>
      </div>
      <TestModeBanner label="TEST MODE — RECORDED EVENTS ONLY" />
      <Panel title="Recent events">
        {!events || events.length === 0 ? (
          <EmptyState title="No events recorded" />
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Link
                  href={`/integrations/events?event=${e.id}`}
                  className="font-medium text-forest hover:underline"
                >
                  {e.event_type as string}
                </Link>
                <EventStatusBadge status={e.status as string} />
                <span className="ml-auto text-xs text-text-secondary">
                  {new Date(e.received_at as string).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
