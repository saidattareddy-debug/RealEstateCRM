import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import {
  ModelManager,
  type ChatModelRow,
  type EmbeddingModelRow,
  type ProviderOption,
} from './models-manage';

export const dynamic = 'force-dynamic';

export default async function AiModelsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }
  const canManage = ensurePermission(ctx, 'ai.providers.manage');

  const supabase = await createSupabaseServerClient();
  const [{ data: providersData }, { data: chatData }, { data: embedData }] = await Promise.all([
    supabase
      .from('ai_provider_configs')
      .select('id, kind, display_name')
      .eq('tenant_id', ctx.activeTenantId!)
      .eq('active', true)
      .order('display_name', { ascending: true }),
    supabase
      .from('ai_model_configs')
      .select(
        'id, provider_config_id, model_name, max_input_tokens, max_output_tokens, temperature, active',
      )
      .eq('tenant_id', ctx.activeTenantId!)
      .order('model_name', { ascending: true }),
    supabase
      .from('embedding_model_configs')
      .select('id, provider_config_id, model_name, dimensions, active')
      .eq('tenant_id', ctx.activeTenantId!)
      .order('model_name', { ascending: true }),
  ]);

  const allProviders = (providersData ?? []) as {
    id: string;
    kind: string;
    display_name: string;
  }[];
  const chatProviders: ProviderOption[] = allProviders
    .filter((p) => p.kind === 'chat')
    .map((p) => ({ id: p.id, display_name: p.display_name }));
  const embeddingProviders: ProviderOption[] = allProviders
    .filter((p) => p.kind === 'embedding')
    .map((p) => ({ id: p.id, display_name: p.display_name }));

  const chatModels = (chatData as ChatModelRow[] | null) ?? [];
  const embeddingModels = (embedData as EmbeddingModelRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/ai" className="text-xs text-text-secondary hover:text-text-primary">
          ← AI settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-text-primary">AI models</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Configure chat models (token budgets, temperature) and embedding models (dimensions)
          independently. Each model references one of your active providers.
        </p>
      </div>

      <Panel title="Models">
        {canManage ? (
          <ModelManager
            chatProviders={chatProviders}
            embeddingProviders={embeddingProviders}
            chatModels={chatModels}
            embeddingModels={embeddingModels}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            You can view but not change AI models (requires the AI providers-manage permission).
            {chatModels.length + embeddingModels.length === 0
              ? ' No models are configured yet.'
              : ` ${chatModels.length} chat model(s) and ${embeddingModels.length} embedding model(s) configured.`}
          </p>
        )}
      </Panel>
    </div>
  );
}
