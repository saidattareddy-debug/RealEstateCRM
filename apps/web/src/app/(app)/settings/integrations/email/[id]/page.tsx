import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestModeBanner, StatusBadge } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.email.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: conn } = await supabase
    .from('integration_connections')
    .select('id, display_name, status, provider')
    .eq('id', id)
    .maybeSingle();
  if (!conn || (conn.provider !== 'gmail' && conn.provider !== 'imap_email')) notFound();

  const { count: ruleCount } = await supabase
    .from('email_parsing_rules')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings/integrations/email" className="text-sm text-forest hover:underline">
            ← Email
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-text-primary">
            {conn.display_name as string}
            <StatusBadge status={conn.status as string} />
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/settings/integrations/email/${id}/rules`}
            className="text-forest hover:underline"
          >
            Rules →
          </Link>
          <Link
            href={`/settings/integrations/email/${id}/test`}
            className="text-forest hover:underline"
          >
            Test →
          </Link>
        </div>
      </div>

      <TestModeBanner label="TEST MODE — NO MAILBOX CONNECTED" />

      <Panel title="Overview">
        <p className="text-sm text-text-secondary">
          Parsing rules: {ruleCount ?? 0}. No mailbox is connected; the Test page runs a synthetic
          email through the deterministic parser.
        </p>
      </Panel>
    </div>
  );
}
