import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner } from '../../ui';
import { MappingForm } from '../../mapping-actions-client';

export const dynamic = 'force-dynamic';

export default async function ConnectionMappingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'integrations.mappings.manage');

  const supabase = await createSupabaseServerClient();
  const { data: mappings } = await supabase
    .from('external_source_mappings')
    .select('id, source_ref, lead_source, channel, version, ambiguous, project_id')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/settings/integrations/${id}`} className="text-sm text-forest hover:underline">
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Source mappings</h1>
        <p className="text-sm text-text-secondary">
          Map external source references to projects, lead sources and channels.
        </p>
      </div>
      <TestModeBanner label="TEST MODE — MAPPINGS ONLY, NO INGESTION TRIGGERED" />

      {canManage ? (
        <Panel title="New mapping">
          <MappingForm />
        </Panel>
      ) : null}

      <Panel title="Mappings">
        {!mappings || mappings.length === 0 ? (
          <EmptyState title="No mappings yet" />
        ) : (
          <ul className="divide-y divide-border">
            {mappings.map((m) => (
              <li key={m.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium text-text-primary">{m.source_ref as string}</span>
                <span className="text-xs text-text-secondary">
                  v{m.version as number}
                  {m.lead_source ? ` · ${m.lead_source as string}` : ''}
                  {m.channel ? ` · ${m.channel as string}` : ''}
                </span>
                {m.ambiguous ? (
                  <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                    ambiguous
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
