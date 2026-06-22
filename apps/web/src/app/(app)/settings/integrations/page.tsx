import Link from 'next/link';
import { publicWebhooksEnabled, deploymentProfile } from '@re/config';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner, StatusBadge, HealthBadge } from './ui';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'integrations.manage');
  const webhooksLive = publicWebhooksEnabled();
  const profile = deploymentProfile();

  const supabase = await createSupabaseServerClient();
  const { data: connections } = await supabase
    .from('integration_connections')
    .select('id, provider, integration_kind, display_name, status, health_state, updated_at')
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Integrations</h1>
          <p className="text-sm text-text-secondary">
            External provider connections. Phase 7A is mock / record-only.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/integrations/events" className="text-forest hover:underline">
            Events →
          </Link>
          <Link href="/settings/integrations/whatsapp" className="text-forest hover:underline">
            WhatsApp →
          </Link>
          <Link href="/settings/integrations/email" className="text-forest hover:underline">
            Email →
          </Link>
          {canManage ? (
            <Link
              href="/settings/integrations/new"
              className="rounded-md bg-forest px-3 py-1.5 font-medium text-white hover:bg-forest-deep"
            >
              New connection
            </Link>
          ) : null}
        </div>
      </div>

      <TestModeBanner label="TEST MODE — NO EXTERNAL SERVICE CONTACTED" />

      <Panel title="Environment status">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Deployment profile</dt>
            <dd className="font-medium text-text-primary">
              {profile === 'controlled_mvp' ? 'Controlled MVP' : 'Full'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Public provider webhooks</dt>
            <dd
              className={`font-medium ${webhooksLive ? 'text-forest' : 'text-amber-700'}`}
              data-testid="public-webhooks-status"
            >
              {webhooksLive ? 'Enabled' : 'Public webhooks disabled'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Real provider adapters</dt>
            <dd className="font-medium text-amber-700">Disabled (simulation only)</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Human / AI customer sending</dt>
            <dd className="font-medium text-amber-700">Simulation only — never sent</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Binary media retrieval</dt>
            <dd className="font-medium text-amber-700">Disabled</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">Background execution</dt>
            <dd className="font-medium text-amber-700">Local-sync (non-production)</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-secondary">
          These features are not live in this deployment. Provider webhooks and real adapters
          activate only in Phase 7B after external review.
        </p>
      </Panel>

      <Panel title="Connections">
        {!connections || connections.length === 0 ? (
          <EmptyState
            title="No integrations yet"
            hint={canManage ? 'Create a draft connection to begin.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {connections.map((c) => (
              <li key={c.id as string} className="flex flex-wrap items-center gap-3 py-3">
                <Link
                  href={`/settings/integrations/${c.id}`}
                  className="font-medium text-forest hover:underline"
                >
                  {c.display_name as string}
                </Link>
                <span className="text-xs text-text-secondary">{c.provider as string}</span>
                <StatusBadge status={c.status as string} />
                <HealthBadge state={c.health_state as string} />
                <span className="ml-auto text-xs text-text-secondary">
                  {c.integration_kind as string}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
