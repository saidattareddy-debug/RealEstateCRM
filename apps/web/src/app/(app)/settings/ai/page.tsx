import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';

export const dynamic = 'force-dynamic';

const OPERATING_LEVEL_HINT: Record<string, string> = {
  disabled: 'AI answering is off.',
  shadow: 'AI runs are logged for review only — nothing is sent.',
  copilot: 'AI drafts are offered to agents — never sent automatically.',
  automatic: 'Stored, but automatic answering is NOT enabled in Phase 5A.',
};

const SUB_PAGES: { href: string; title: string; description: string }[] = [
  {
    href: '/settings/ai/providers',
    title: 'Providers',
    description: 'Chat & embedding providers. Credentials are referenced by env-var name only.',
  },
  {
    href: '/settings/ai/models',
    title: 'Models',
    description: 'Chat and embedding model configurations (tokens, temperature, dimensions).',
  },
  {
    href: '/settings/ai/prompts',
    title: 'Prompts',
    description: 'Versioned prompts. New versions are inactive until explicitly activated.',
  },
  {
    href: '/settings/ai/policies',
    title: 'Policies',
    description: 'Tenant and per-project operating level, general answers, language & escalation.',
  },
  {
    href: '/settings/ai/usage',
    title: 'Usage limits',
    description: 'Token, retrieval, tool-call and retry limits for this workspace.',
  },
];

export default async function AiSettingsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: tenantPolicy }, { data: usage }, { data: providers }] = await Promise.all([
    supabase
      .from('ai_feature_policies')
      .select('operating_level, general_answers_enabled, copilot_enabled, shadow_sample_rate')
      .eq('tenant_id', ctx.activeTenantId!)
      .is('project_id', null)
      .maybeSingle(),
    supabase
      .from('ai_usage_limits')
      .select('daily_token_limit, monthly_token_limit, per_conversation_token_limit')
      .eq('tenant_id', ctx.activeTenantId!)
      .maybeSingle(),
    supabase
      .from('ai_provider_configs')
      .select('id, kind, adapter, display_name, active, available')
      .eq('tenant_id', ctx.activeTenantId!)
      .order('kind', { ascending: true }),
  ]);

  const level = (tenantPolicy?.operating_level as string | undefined) ?? 'disabled';
  const providerList = (providers ?? []) as {
    id: string;
    kind: string;
    adapter: string;
    display_name: string;
    active: boolean;
    available: boolean;
  }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">AI settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Configure the AI providers, models, prompts, policies and usage limits for this workspace.
          In this phase the AI never sends a customer message — drafts and shadow runs only.
        </p>
      </div>

      <Panel title="Tenant policy">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Operating level" value={level} hint={OPERATING_LEVEL_HINT[level]} />
          <StatCard
            label="General answers"
            value={tenantPolicy?.general_answers_enabled ? 'Enabled' : 'Disabled'}
          />
          <StatCard
            label="Copilot drafts"
            value={tenantPolicy?.copilot_enabled ? 'Enabled' : 'Disabled'}
          />
        </div>
        {!tenantPolicy ? (
          <p className="mt-3 text-xs text-text-secondary">
            No tenant policy yet — the workspace defaults to AI disabled.
          </p>
        ) : null}
      </Panel>

      <Panel title="Usage snapshot">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Daily token limit"
            value={(usage?.daily_token_limit as number | undefined)?.toLocaleString() ?? '—'}
          />
          <StatCard
            label="Monthly token limit"
            value={(usage?.monthly_token_limit as number | undefined)?.toLocaleString() ?? '—'}
          />
          <StatCard
            label="Per-conversation limit"
            value={
              (usage?.per_conversation_token_limit as number | undefined)?.toLocaleString() ?? '—'
            }
          />
        </div>
      </Panel>

      <Panel title="Provider availability">
        {providerList.length === 0 ? (
          <p className="text-sm text-text-secondary">No providers configured yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {providerList.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="font-medium text-text-primary">{p.display_name}</span>
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                  {p.kind}
                </span>
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                  {p.adapter}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {p.available ? (
                    <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
                      available
                    </span>
                  ) : (
                    <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-medium text-terracotta">
                      unavailable
                    </span>
                  )}
                  {!p.active ? (
                    <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs text-text-secondary">
                      inactive
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-text-secondary">
          External providers stay unavailable until a server-side credential is wired in. This
          screen never fakes a connection.
        </p>
      </Panel>

      <Panel title="Configure">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SUB_PAGES.map((page) => (
            <li key={page.href}>
              <Link
                href={page.href}
                className="block rounded-lg border border-border bg-surface-elevated p-4 hover:border-forest"
              >
                <p className="text-sm font-semibold text-text-primary">{page.title}</p>
                <p className="mt-1 text-xs text-text-secondary">{page.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
