import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner, StatusBadge } from '../ui';

export const dynamic = 'force-dynamic';

export default async function WhatsAppPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.whatsapp.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: connections } = await supabase
    .from('integration_connections')
    .select('id, display_name, status, health_state')
    .eq('provider', 'whatsapp_cloud')
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">WhatsApp</h1>
          <p className="text-sm text-text-secondary">
            WhatsApp Cloud connections. Mock inbound, mock delivery, simulated sends.
          </p>
        </div>
        <Link href="/settings/integrations" className="text-sm text-forest hover:underline">
          ← Integrations
        </Link>
      </div>

      <TestModeBanner label="TEST MODE — NO WHATSAPP MESSAGE SENT" />

      <Panel title="WhatsApp connections">
        {!connections || connections.length === 0 ? (
          <EmptyState
            title="No WhatsApp connections"
            hint="Create a whatsapp_cloud connection from Integrations."
          />
        ) : (
          <ul className="divide-y divide-border">
            {connections.map((c) => (
              <li key={c.id as string} className="flex flex-wrap items-center gap-3 py-3">
                <Link
                  href={`/settings/integrations/whatsapp/${c.id}`}
                  className="font-medium text-forest hover:underline"
                >
                  {c.display_name as string}
                </Link>
                <StatusBadge status={c.status as string} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
