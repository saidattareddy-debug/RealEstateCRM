import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner, StatusBadge, HealthBadge } from '../ui';
import { ConnectionLifecycleActions, SecretRefForm } from '../connection-actions';

export const dynamic = 'force-dynamic';

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'integrations.manage');
  const canCreds = ensurePermission(ctx, 'integrations.credentials.manage');

  const supabase = await createSupabaseServerClient();
  const { data: conn } = await supabase
    .from('integration_connections')
    .select(
      'id, provider, integration_kind, display_name, status, health_state, environment, allowed_event_types, last_success_at, last_failure_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (!conn) notFound();

  const { data: versions } = await supabase
    .from('integration_connection_versions')
    .select('version, active, created_at')
    .eq('connection_id', id)
    .order('version', { ascending: false });

  // Credential METADATA only (secret_ref + type) — never a secret value.
  const { data: creds } = await supabase
    .from('integration_credentials_metadata')
    .select('credential_type, secret_ref, verification_status, expires_at')
    .eq('connection_id', id)
    .order('created_at', { ascending: true });

  const { data: endpoint } = await supabase
    .from('channel_webhook_endpoints')
    .select('public_path, active')
    .eq('connection_id', id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings/integrations" className="text-sm text-forest hover:underline">
            ← Integrations
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-text-primary">
            {conn.display_name as string}
            <StatusBadge status={conn.status as string} />
            <HealthBadge state={conn.health_state as string} />
          </h1>
          <p className="text-sm text-text-secondary">
            {conn.provider as string} · {conn.integration_kind as string} ·{' '}
            {conn.environment as string}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/settings/integrations/${id}/events`}
            className="text-forest hover:underline"
          >
            Events →
          </Link>
          <Link
            href={`/settings/integrations/${id}/health`}
            className="text-forest hover:underline"
          >
            Health →
          </Link>
          <Link
            href={`/settings/integrations/${id}/mappings`}
            className="text-forest hover:underline"
          >
            Mappings →
          </Link>
          <Link
            href={`/settings/integrations/${id}/replay`}
            className="text-forest hover:underline"
          >
            Replay →
          </Link>
        </div>
      </div>

      <TestModeBanner label="TEST MODE — MOCK ADAPTER, NO EXTERNAL IO" />

      {canManage ? (
        <Panel title="Lifecycle">
          <ConnectionLifecycleActions connectionId={id} status={conn.status as string} />
          <p className="mt-2 text-xs text-text-secondary">
            Mock verification moves this connection to <strong>test</strong> — never to a live
            “connected” state.
          </p>
        </Panel>
      ) : null}

      <Panel title="Configuration versions">
        {!versions || versions.length === 0 ? (
          <EmptyState title="No configuration yet" />
        ) : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.version as number}
                className="flex items-center gap-3 rounded-md border border-border p-2 text-sm"
              >
                <span className="font-medium text-text-primary">v{v.version as number}</span>
                {v.active ? (
                  <span className="rounded-full border border-forest/40 bg-forest/10 px-2 py-0.5 text-xs text-forest">
                    active
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-text-secondary">
                  {new Date(v.created_at as string).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Credentials (reference only)">
        {!creds || creds.length === 0 ? (
          <EmptyState
            title="No credential references"
            hint={canCreds ? 'Add a secret reference below.' : undefined}
          />
        ) : (
          <ul className="space-y-2">
            {creds.map((c) => (
              <li
                key={c.credential_type as string}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-sm"
              >
                <span className="font-medium text-text-primary">{c.credential_type as string}</span>
                <span className="text-xs text-text-secondary">
                  ref: <code>{c.secret_ref as string}</code>
                </span>
                <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                  {c.verification_status as string}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canCreds ? (
          <div className="mt-4 border-t border-border pt-4">
            <SecretRefForm connectionId={id} />
          </div>
        ) : null}
      </Panel>

      <Panel title="Webhook endpoint">
        {endpoint ? (
          <p className="text-sm text-text-secondary">
            Path: <code>{endpoint.public_path as string}</code> ·{' '}
            {endpoint.active ? 'active' : 'inactive'} · POST to{' '}
            <code>/api/integrations/{id}/webhook</code> (mock).
          </p>
        ) : (
          <EmptyState
            title="No webhook endpoint configured"
            hint="The mock route /api/integrations/[id]/webhook records events; configure an endpoint row to enable acceptance."
          />
        )}
      </Panel>
    </div>
  );
}
