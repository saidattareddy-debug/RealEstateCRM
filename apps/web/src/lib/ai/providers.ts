import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  createMockChatProvider,
  createMockEmbeddingProvider,
  type ChatGenerationResult,
  type ChatMessage,
  type ChatProvider,
  type EmbeddingProvider,
} from '@re/domain';
import { liveProviderActivationEnabled } from '@re/config';

const DEFAULT_MOCK_EMBED_DIMENSIONS = 16;

export type AiProviderVendor = 'mock' | 'anthropic' | 'openai' | 'gemini';
export type ProviderAvailabilityReason =
  | 'no_active_model'
  | 'no_active_provider'
  | 'provider_inactive'
  | 'runtime_flag_off'
  | 'secret_missing'
  | 'unsupported_vendor';

interface ProviderConfigRow {
  id: string;
  kind: 'chat' | 'embedding';
  adapter: 'mock' | 'external';
  vendor: AiProviderVendor;
  display_name: string;
  secret_ref: string | null;
  base_url: string | null;
  active: boolean;
  available: boolean;
}

interface ChatModelConfigRow {
  id: string;
  provider_config_id: string;
  model_name: string;
  max_input_tokens: number;
  max_output_tokens: number;
  temperature: number;
  active: boolean;
}

interface EmbeddingModelConfigRow {
  id: string;
  provider_config_id: string;
  model_name: string;
  dimensions: number;
  active: boolean;
}

export interface ProviderResolutionStatus {
  available: boolean;
  externalAvailable: boolean;
  usingMock: boolean;
  reason: ProviderAvailabilityReason | null;
  adapter: 'mock' | 'external' | null;
  vendor: AiProviderVendor | null;
  providerConfigId: string | null;
  providerDisplayName: string | null;
  modelConfigId: string | null;
  modelName: string | null;
}

export interface ResolvedChatProvider extends ProviderResolutionStatus {
  provider: ChatProvider;
  maxOutputTokens: number | null;
  temperature: number | null;
}

export interface ResolvedEmbeddingProvider extends ProviderResolutionStatus {
  provider: EmbeddingProvider;
  dimensions: number;
}

function resolveSecret(secretRef: string | null | undefined): string | null {
  if (!secretRef || !/^[A-Z0-9_]+$/.test(secretRef)) return null;
  const value = process.env[secretRef];
  return value && value.length > 0 ? value : null;
}

function fallbackChat(reason: ProviderAvailabilityReason | null = null): ResolvedChatProvider {
  return {
    provider: createMockChatProvider(),
    available: reason === null,
    externalAvailable: false,
    usingMock: true,
    reason,
    adapter: 'mock',
    vendor: 'mock',
    providerConfigId: null,
    providerDisplayName: null,
    modelConfigId: null,
    modelName: null,
    maxOutputTokens: null,
    temperature: null,
  };
}

function fallbackEmbedding(
  dimensions = DEFAULT_MOCK_EMBED_DIMENSIONS,
  reason: ProviderAvailabilityReason | null = null,
): ResolvedEmbeddingProvider {
  return {
    provider: createMockEmbeddingProvider(dimensions),
    available: reason === null,
    externalAvailable: false,
    usingMock: true,
    reason,
    adapter: 'mock',
    vendor: 'mock',
    providerConfigId: null,
    providerDisplayName: null,
    modelConfigId: null,
    modelName: null,
    dimensions,
  };
}

async function loadActiveChatModel(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ChatModelConfigRow | null> {
  const { data } = await supabase
    .from('ai_model_configs')
    .select(
      'id, provider_config_id, model_name, max_input_tokens, max_output_tokens, temperature, active',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as ChatModelConfigRow | null) ?? null;
}

async function loadActiveEmbeddingModel(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<EmbeddingModelConfigRow | null> {
  const { data } = await supabase
    .from('embedding_model_configs')
    .select('id, provider_config_id, model_name, dimensions, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as EmbeddingModelConfigRow | null) ?? null;
}

async function loadProvider(
  supabase: SupabaseClient,
  tenantId: string,
  providerConfigId: string,
): Promise<ProviderConfigRow | null> {
  const { data } = await supabase
    .from('ai_provider_configs')
    .select('id, kind, adapter, vendor, display_name, secret_ref, base_url, active, available')
    .eq('tenant_id', tenantId)
    .eq('id', providerConfigId)
    .maybeSingle();
  return (data as ProviderConfigRow | null) ?? null;
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: { role: 'user' | 'assistant'; content: string }[];
} {
  const systemParts: string[] = [];
  const converted: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    converted.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.role === 'data' ? `[reference data]\n${message.content}` : message.content,
    });
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: converted.length > 0 ? converted : [{ role: 'user', content: ' ' }],
  };
}

function createAnthropicChatProvider(args: {
  apiKey: string;
  baseUrl: string | null;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
}): ChatProvider {
  const client = new Anthropic({
    apiKey: args.apiKey,
    baseURL: args.baseUrl ?? undefined,
    maxRetries: 0,
    timeout: 30_000,
  });
  return {
    async generate(request): Promise<ChatGenerationResult> {
      const payload = toAnthropicMessages(request.messages);
      const response = await client.messages.create({
        model: args.modelName,
        system: payload.system,
        messages: payload.messages,
        temperature: args.temperature,
        max_tokens: Math.max(
          1,
          Math.min(request.maxOutputTokens ?? args.maxOutputTokens, args.maxOutputTokens),
        ),
      });
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return {
        text: text || '[empty-draft]',
        usage: {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
        },
        modelVersion: response.model,
        development: false,
        finishReason: response.stop_reason === 'max_tokens' ? 'length' : 'stop',
      };
    },
  };
}

function createOpenAiEmbeddingProvider(args: {
  apiKey: string;
  baseUrl: string | null;
  modelName: string;
  dimensions: number;
}): EmbeddingProvider {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseUrl ?? undefined,
    maxRetries: 0,
    timeout: 30_000,
  });
  const mapResult = (
    vector: number[],
    modelVersion: string,
    tokensUsed: number,
    dimensions: number,
  ) => ({
    vector,
    dimensions,
    modelVersion,
    development: false,
    tokensUsed,
  });
  return {
    async embedDocuments(inputs) {
      if (inputs.length === 0) return [];
      const response = await client.embeddings.create({
        model: args.modelName,
        input: inputs.map((input) => input.text),
        encoding_format: 'float',
        dimensions: args.dimensions,
      });
      const totalTokens = response.usage?.total_tokens ?? 0;
      const perItemTokens = inputs.length > 0 ? Math.ceil(totalTokens / inputs.length) : 0;
      return response.data.map((item) =>
        mapResult(item.embedding, response.model, perItemTokens, item.embedding.length),
      );
    },
    async embedQuery(input) {
      const response = await client.embeddings.create({
        model: args.modelName,
        input: input.text,
        encoding_format: 'float',
        dimensions: args.dimensions,
      });
      const embedding = response.data[0]?.embedding ?? [];
      return mapResult(
        embedding,
        response.model,
        response.usage?.total_tokens ?? Math.ceil(input.text.length / 4),
        embedding.length,
      );
    },
  };
}

function externalProvidersEnabled(): boolean {
  return liveProviderActivationEnabled(process.env);
}

export async function resolveChatProvider(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ResolvedChatProvider> {
  const model = await loadActiveChatModel(supabase, tenantId);
  if (!model) return fallbackChat('no_active_model');
  const provider = await loadProvider(supabase, tenantId, model.provider_config_id);
  if (!provider) return fallbackChat('no_active_provider');
  if (!provider.active) return fallbackChat('provider_inactive');

  const base = {
    providerConfigId: provider.id,
    providerDisplayName: provider.display_name,
    modelConfigId: model.id,
    modelName: model.model_name,
    maxOutputTokens: model.max_output_tokens,
    temperature: model.temperature,
  };

  if (provider.adapter === 'mock') {
    return {
      provider: createMockChatProvider(),
      available: true,
      externalAvailable: false,
      usingMock: true,
      reason: null,
      adapter: provider.adapter,
      vendor: provider.vendor,
      ...base,
    };
  }

  if (!externalProvidersEnabled()) {
    return {
      ...fallbackChat('runtime_flag_off'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }
  const secret = resolveSecret(provider.secret_ref);
  if (!secret) {
    return {
      ...fallbackChat('secret_missing'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }
  if (provider.vendor !== 'anthropic') {
    return {
      ...fallbackChat('unsupported_vendor'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }

  return {
    provider: createAnthropicChatProvider({
      apiKey: secret,
      baseUrl: provider.base_url,
      modelName: model.model_name,
      temperature: model.temperature,
      maxOutputTokens: model.max_output_tokens,
    }),
    available: true,
    externalAvailable: true,
    usingMock: false,
    reason: null,
    adapter: provider.adapter,
    vendor: provider.vendor,
    ...base,
  };
}

export async function resolveEmbeddingProvider(
  supabase: SupabaseClient,
  tenantId: string,
  fallbackDimensions = DEFAULT_MOCK_EMBED_DIMENSIONS,
): Promise<ResolvedEmbeddingProvider> {
  const model = await loadActiveEmbeddingModel(supabase, tenantId);
  if (!model) return fallbackEmbedding(fallbackDimensions, 'no_active_model');
  const provider = await loadProvider(supabase, tenantId, model.provider_config_id);
  if (!provider)
    return fallbackEmbedding(model.dimensions || fallbackDimensions, 'no_active_provider');
  if (!provider.active) {
    return fallbackEmbedding(model.dimensions || fallbackDimensions, 'provider_inactive');
  }

  const base = {
    providerConfigId: provider.id,
    providerDisplayName: provider.display_name,
    modelConfigId: model.id,
    modelName: model.model_name,
    dimensions: model.dimensions,
  };

  if (provider.adapter === 'mock') {
    return {
      provider: createMockEmbeddingProvider(model.dimensions),
      available: true,
      externalAvailable: false,
      usingMock: true,
      reason: null,
      adapter: provider.adapter,
      vendor: provider.vendor,
      ...base,
    };
  }

  if (!externalProvidersEnabled()) {
    return {
      ...fallbackEmbedding(model.dimensions, 'runtime_flag_off'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }
  const secret = resolveSecret(provider.secret_ref);
  if (!secret) {
    return {
      ...fallbackEmbedding(model.dimensions, 'secret_missing'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }
  if (provider.vendor !== 'openai') {
    return {
      ...fallbackEmbedding(model.dimensions, 'unsupported_vendor'),
      ...base,
      adapter: provider.adapter,
      vendor: provider.vendor,
    };
  }

  return {
    provider: createOpenAiEmbeddingProvider({
      apiKey: secret,
      baseUrl: provider.base_url,
      modelName: model.model_name,
      dimensions: model.dimensions,
    }),
    available: true,
    externalAvailable: true,
    usingMock: false,
    reason: null,
    adapter: provider.adapter,
    vendor: provider.vendor,
    ...base,
  };
}

export function providerAvailability() {
  return {
    chat: externalProvidersEnabled() && Boolean(process.env.ANTHROPIC_API_KEY),
    embedding: externalProvidersEnabled() && Boolean(process.env.OPENAI_API_KEY),
  };
}
