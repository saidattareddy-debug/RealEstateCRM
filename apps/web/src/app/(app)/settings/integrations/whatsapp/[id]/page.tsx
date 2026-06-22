import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestModeBanner, StatusBadge } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function WhatsAppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.whatsapp.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: conn } = await supabase
    .from('integration_connections')
    .select('id, display_name, status, provider')
    .eq('id', id)
    .maybeSingle();
  if (!conn || conn.provider !== 'whatsapp_cloud') notFound();

  const { count: templateCount } = await supabase
    .from('whatsapp_message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/settings/integrations/whatsapp"
            className="text-sm text-forest hover:underline"
          >
            ← WhatsApp
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-text-primary">
            {conn.display_name as string}
            <StatusBadge status={conn.status as string} />
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/settings/integrations/whatsapp/${id}/templates`}
            className="text-forest hover:underline"
          >
            Templates →
          </Link>
          <Link
            href={`/settings/integrations/whatsapp/${id}/test`}
            className="text-forest hover:underline"
          >
            Test →
          </Link>
        </div>
      </div>

      <TestModeBanner label="TEST MODE — NO WHATSAPP MESSAGE SENT" />

      <Panel title="Overview">
        <p className="text-sm text-text-secondary">
          Templates: {templateCount ?? 0}. Use the Test page to record a mock inbound, a mock
          delivery callback, or run a human-send simulation.
        </p>
      </Panel>
    </div>
  );
}
