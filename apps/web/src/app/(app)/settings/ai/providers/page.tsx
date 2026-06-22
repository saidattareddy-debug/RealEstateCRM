import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { ProviderManager, type ProviderRow } from './providers-manage';

export const dynamic = 'force-dynamic';

export default async function AiProvidersPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }
  const canManage = ensurePermission(ctx, 'ai.providers.manage');

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_provider_configs')
    .select('id, kind, adapter, vendor, display_name, secret_ref, base_url, active, available')
    .eq('tenant_id', ctx.activeTenantId!)
    .order('kind', { ascending: true })
    .order('display_name', { ascending: true });

  const providers = (data as ProviderRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/ai" className="text-xs text-text-secondary hover:text-text-primary">
          ← AI settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-text-primary">AI providers</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Configure chat and embedding providers independently. Provider credentials are referenced
          by the NAME of a server environment variable only — secrets never reach this screen and
          are never stored here.
        </p>
      </div>

      <Panel title="Providers">
        {canManage ? (
          <ProviderManager providers={providers} />
        ) : (
          <ReadOnlyProviders providers={providers} />
        )}
      </Panel>
    </div>
  );
}

function ReadOnlyProviders({ providers }: { providers: ProviderRow[] }) {
  if (providers.length === 0) {
    return <p className="text-sm text-text-secondary">No providers configured yet.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        You can view but not change AI providers (requires the AI providers-manage permission).
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {providers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
            <span className="font-medium text-text-primary">{p.display_name}</span>
            <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
              {p.kind}
            </span>
            <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
              {p.adapter}
            </span>
            <span className="ml-auto">
              {p.available ? (
                <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
                  available
                </span>
              ) : (
                <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-medium text-terracotta">
                  unavailable
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
