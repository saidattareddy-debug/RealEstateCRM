import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestModeBanner } from '../../../ui';
import { EmailTestPanel } from '../../email-test-client';

export const dynamic = 'force-dynamic';

export default async function EmailTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.email.test')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: conn } = await supabase
    .from('integration_connections')
    .select('provider')
    .eq('id', id)
    .maybeSingle();
  if (!conn) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/settings/integrations/email/${id}`}
          className="text-sm text-forest hover:underline"
        >
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Synthetic email test</h1>
        <p className="text-sm text-text-secondary">
          Paste a synthetic portal email; the deterministic parser previews the parsing result. No
          mailbox is connected and nothing is ingested.
        </p>
      </div>
      <TestModeBanner label="TEST MODE — NO MAILBOX CONNECTED" />

      <Panel title="Run synthetic email">
        <EmailTestPanel provider={(conn.provider as string) ?? 'generic_portal'} />
      </Panel>
    </div>
  );
}
