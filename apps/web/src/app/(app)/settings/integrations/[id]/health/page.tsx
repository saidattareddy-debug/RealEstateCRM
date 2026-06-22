import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner, HealthBadge } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function ConnectionHealthPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.health.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: conn } = await supabase
    .from('integration_connections')
    .select('display_name, health_state, last_success_at, last_failure_at')
    .eq('id', id)
    .maybeSingle();
  const { data: events } = await supabase
    .from('integration_health_events')
    .select('health_state, detail, created_at')
    .eq('connection_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/settings/integrations/${id}`} className="text-sm text-forest hover:underline">
          ← Connection
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-text-primary">
          Health
          {conn ? <HealthBadge state={conn.health_state as string} /> : null}
        </h1>
      </div>
      <TestModeBanner label="TEST MODE — DERIVED HEALTH ONLY" />
      <Panel title="Current">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-text-secondary">Last success</dt>
            <dd className="text-text-primary">
              {conn?.last_success_at
                ? new Date(conn.last_success_at as string).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Last failure</dt>
            <dd className="text-text-primary">
              {conn?.last_failure_at
                ? new Date(conn.last_failure_at as string).toLocaleString()
                : '—'}
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Health history">
        {!events || events.length === 0 ? (
          <EmptyState title="No health events" />
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <HealthBadge state={e.health_state as string} />
                <span className="text-text-secondary">{(e.detail as string | null) ?? ''}</span>
                <span className="ml-auto text-xs text-text-secondary">
                  {new Date(e.created_at as string).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
