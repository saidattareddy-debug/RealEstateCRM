#!/usr/bin/env node
/**
 * Configure the demo tenant for live draft providers.
 *
 * This keeps the no-send safety boundary intact while switching the tenant's
 * active AI config toward:
 *   - Anthropic chat drafts when ANTHROPIC_API_KEY exists
 *   - OpenAI embeddings when OPENAI_API_KEY exists
 *   - deterministic mock fallback for any missing provider key
 *
 * Usage:
 *   pnpm demo:ai:activate --tenant northwind-estates
 */
import { parseArgs } from './demo/cli.mjs';
import { createCliAdminClient, resolveTenant } from './demo/admin.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

const CHAT_MODEL = 'claude-sonnet-4-20250514';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

async function upsertProvider(admin, tenantId, input) {
  const { data: existing } = await admin
    .from('ai_provider_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kind', input.kind)
    .eq('adapter', input.adapter)
    .eq('vendor', input.vendor)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from('ai_provider_configs')
      .update({
        display_name: input.display_name,
        secret_ref: input.secret_ref,
        base_url: input.base_url,
        active: input.active,
        available: input.available,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
    return existing.id;
  }

  const { data, error } = await admin
    .from('ai_provider_configs')
    .insert({ tenant_id: tenantId, ...input })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not create ${input.kind} provider.`);
  return data.id;
}

async function upsertChatModel(admin, tenantId, providerConfigId, active) {
  const { data: existing } = await admin
    .from('ai_model_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider_config_id', providerConfigId)
    .eq('model_name', CHAT_MODEL)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from('ai_model_configs')
      .update({
        max_input_tokens: 200000,
        max_output_tokens: 1500,
        temperature: 0.2,
        active,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
    return existing.id;
  }

  const { data, error } = await admin
    .from('ai_model_configs')
    .insert({
      tenant_id: tenantId,
      provider_config_id: providerConfigId,
      model_name: CHAT_MODEL,
      max_input_tokens: 200000,
      max_output_tokens: 1500,
      temperature: 0.2,
      active,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('Could not create the Anthropic chat model.');
  return data.id;
}

async function upsertEmbeddingModel(admin, tenantId, providerConfigId, active) {
  const { data: existing } = await admin
    .from('embedding_model_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider_config_id', providerConfigId)
    .eq('model_name', EMBEDDING_MODEL)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from('embedding_model_configs')
      .update({ dimensions: EMBEDDING_DIMENSIONS, active })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
    return existing.id;
  }

  const { data, error } = await admin
    .from('embedding_model_configs')
    .insert({
      tenant_id: tenantId,
      provider_config_id: providerConfigId,
      model_name: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      active,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('Could not create the OpenAI embedding model.');
  return data.id;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { env } = loadLocalEnv();
  const admin = await createCliAdminClient(env);
  const tenant = await resolveTenant(admin, { tenantArg: opts.tenant, allowCreate: false });

  const chatLive = Boolean(env.ANTHROPIC_API_KEY);
  const embeddingLive = Boolean(env.OPENAI_API_KEY);

  const chatProviderId = await upsertProvider(admin, tenant.id, {
    kind: 'chat',
    adapter: chatLive ? 'external' : 'mock',
    vendor: chatLive ? 'anthropic' : 'mock',
    display_name: chatLive ? 'Anthropic drafts' : 'Development mock chat',
    secret_ref: chatLive ? 'ANTHROPIC_API_KEY' : null,
    base_url: null,
    active: true,
    available: chatLive,
  });
  await admin.from('ai_model_configs').update({ active: false }).eq('tenant_id', tenant.id);
  await upsertChatModel(admin, tenant.id, chatProviderId, true);
  await admin
    .from('ai_provider_configs')
    .update({ active: false })
    .eq('tenant_id', tenant.id)
    .eq('kind', 'chat')
    .neq('id', chatProviderId);

  const embeddingProviderId = await upsertProvider(admin, tenant.id, {
    kind: 'embedding',
    adapter: embeddingLive ? 'external' : 'mock',
    vendor: embeddingLive ? 'openai' : 'mock',
    display_name: embeddingLive ? 'OpenAI embeddings' : 'Development mock embeddings',
    secret_ref: embeddingLive ? 'OPENAI_API_KEY' : null,
    base_url: null,
    active: true,
    available: embeddingLive,
  });
  await admin.from('embedding_model_configs').update({ active: false }).eq('tenant_id', tenant.id);
  await upsertEmbeddingModel(admin, tenant.id, embeddingProviderId, true);
  await admin
    .from('ai_provider_configs')
    .update({ active: false })
    .eq('tenant_id', tenant.id)
    .eq('kind', 'embedding')
    .neq('id', embeddingProviderId);

  await admin
    .from('ai_feature_policies')
    .update({
      operating_level: 'copilot',
      copilot_enabled: true,
      general_answers_enabled: true,
      shadow_sample_rate: 0.25,
    })
    .eq('tenant_id', tenant.id)
    .is('project_id', null);

  console.log('\n=== Demo AI activation ===');
  console.log('  Tenant       :', `${tenant.name} (${tenant.slug})`);
  console.log(
    '  Env gate     :',
    env.INTEGRATION_LIVE_PROVIDERS_ENABLED === 'true' ? 'enabled' : 'disabled',
  );
  console.log(
    '  Chat runtime :',
    chatLive ? 'Anthropic drafts configured' : 'mock fallback (missing ANTHROPIC_API_KEY)',
  );
  console.log(
    '  Embeddings   :',
    embeddingLive ? 'OpenAI embeddings configured' : 'mock fallback (missing OPENAI_API_KEY)',
  );
  console.log('  Policy       : copilot drafts enabled, customer send still blocked');
  console.log('==========================\n');
}

main().catch((error) => {
  console.error('demo:ai:activate failed:', error.message);
  process.exit(1);
});
