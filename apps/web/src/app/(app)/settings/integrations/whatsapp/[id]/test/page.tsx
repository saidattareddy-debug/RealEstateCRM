import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestModeBanner } from '../../../ui';
import { WhatsAppTestPanel } from '../../whatsapp-test-client';

export const dynamic = 'force-dynamic';

export default async function WhatsAppTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.whatsapp.test')) return <PermissionDenied />;
  const canSimulate = ensurePermission(ctx, 'channels.human_send.simulate');

  const supabase = await createSupabaseServerClient();
  // Offer a few WhatsApp conversations to target for the human-send simulation.
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, subject, channel')
    .order('updated_at', { ascending: false })
    .limit(25);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/settings/integrations/whatsapp/${id}`}
          className="text-sm text-forest hover:underline"
        >
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">WhatsApp test</h1>
      </div>
      <TestModeBanner label="TEST MODE — NO WHATSAPP MESSAGE SENT" />

      <Panel title="Mock inbound &amp; delivery">
        <WhatsAppTestPanel
          connectionId={id}
          canSimulate={canSimulate}
          conversations={(conversations ?? []).map((c) => ({
            id: c.id as string,
            label: (c.subject as string | null) ?? (c.id as string).slice(0, 8),
          }))}
        />
      </Panel>
    </div>
  );
}
