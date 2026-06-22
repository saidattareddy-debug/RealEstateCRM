import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner } from '../../ui';
import { EventStatusBadge } from '../../events-ui';
import { ReplayButton } from '../../replay-client';

export const dynamic = 'force-dynamic';

export default async function ConnectionReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.events.read')) return <PermissionDenied />;
  const canReplay = ensurePermission(ctx, 'integrations.events.replay');

  const supabase = await createSupabaseServerClient();
  // Failed / dead-lettered events are the replay candidates.
  const { data: events } = await supabase
    .from('external_events')
    .select('id, event_type, status, received_at')
    .eq('connection_id', id)
    .in('status', ['failed', 'dead_letter', 'rejected'])
    .order('received_at', { ascending: false })
    .limit(100);

  const { data: replays } = await supabase
    .from('external_event_replays')
    .select('id, event_id, reason, state, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/settings/integrations/${id}`} className="text-sm text-forest hover:underline">
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Dead-letter &amp; replay</h1>
        <p className="text-sm text-text-secondary">
          Replaying re-runs processing under the same idempotency key — it cannot duplicate a
          successful side effect.
        </p>
      </div>
      <TestModeBanner label="TEST MODE — REPLAY RECORD-ONLY" />

      <Panel title="Replay candidates">
        {!events || events.length === 0 ? (
          <EmptyState title="No failed or dead-lettered events" />
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium text-text-primary">{e.event_type as string}</span>
                <EventStatusBadge status={e.status as string} />
                <span className="text-xs text-text-secondary">
                  {new Date(e.received_at as string).toLocaleString()}
                </span>
                {canReplay ? <ReplayButton eventId={e.id as string} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Replay history">
        {!replays || replays.length === 0 ? (
          <EmptyState title="No replays requested" />
        ) : (
          <ul className="divide-y divide-border">
            {replays.map((r) => (
              <li key={r.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="text-text-secondary">{r.state as string}</span>
                <span className="text-text-primary">{r.reason as string}</span>
                <span className="ml-auto text-xs text-text-secondary">
                  {new Date(r.created_at as string).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
