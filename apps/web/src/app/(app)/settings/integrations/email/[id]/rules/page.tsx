import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { TestModeBanner } from '../../../ui';
import { RuleManager } from '../../email-rules-client';

export const dynamic = 'force-dynamic';

export default async function EmailRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'channels.email.read')) return <PermissionDenied />;
  const canManage = ensurePermission(ctx, 'channels.email.rules.manage');

  const supabase = await createSupabaseServerClient();
  const { data: rules } = await supabase
    .from('email_parsing_rules')
    .select('id, name, adapter, version, active')
    .eq('connection_id', id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/settings/integrations/email/${id}`}
          className="text-sm text-forest hover:underline"
        >
          ← Connection
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Parsing rules</h1>
      </div>
      <TestModeBanner label="TEST MODE — RULES ONLY, NO MAILBOX" />

      {canManage ? (
        <Panel title="New rule">
          <RuleManager connectionId={id} mode="create" />
        </Panel>
      ) : null}

      <Panel title="Rules">
        {!rules || rules.length === 0 ? (
          <EmptyState title="No parsing rules" />
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((r) => (
              <li key={r.id as string} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium text-text-primary">{r.name as string}</span>
                <span className="text-xs text-text-secondary">
                  {r.adapter as string} · v{r.version as number}
                </span>
                {canManage ? (
                  <RuleManager
                    connectionId={id}
                    mode="toggle"
                    ruleId={r.id as string}
                    active={Boolean(r.active)}
                  />
                ) : (
                  <span className="text-xs text-text-secondary">
                    {r.active ? 'active' : 'disabled'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
