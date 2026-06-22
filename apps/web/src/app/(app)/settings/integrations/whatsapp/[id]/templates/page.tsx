import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner } from '../../../ui';
import { TemplateManager } from '../../template-client';

export const dynamic = 'force-dynamic';

export default async function WhatsAppTemplatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.whatsapp.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'channels.whatsapp.templates.manage');

  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from('whatsapp_message_templates')
    .select('id, name, language, category, status, last_synced_at')
    .eq('connection_id', id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/settings/integrations/whatsapp/${id}`}
          className="text-sm text-forest hover:underline"
        >
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Templates</h1>
        <p className="text-sm text-text-secondary">
          Import a fixture or create a local draft. Nothing is submitted to a provider.
        </p>
      </div>
      <TestModeBanner label="TEST MODE — TEMPLATES ARE FIXTURES, NOTHING SUBMITTED" />

      {canManage ? (
        <Panel title="Add template">
          <TemplateManager connectionId={id} />
        </Panel>
      ) : null}

      <Panel title="Templates">
        {!templates || templates.length === 0 ? (
          <EmptyState title="No templates" />
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <li key={t.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium text-text-primary">{t.name as string}</span>
                <span className="text-xs text-text-secondary">{t.language as string}</span>
                <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                  {t.status as string}
                </span>
                {t.category ? (
                  <span className="text-xs text-text-secondary">{t.category as string}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
