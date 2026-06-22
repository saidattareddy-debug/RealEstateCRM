import { afterEach, describe, expect, it, vi } from 'vitest';

const anthropicCreate = vi.fn();
const openaiEmbeddingsCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicCreate };
  },
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    embeddings = { create: openaiEmbeddingsCreate };
  },
}));

import { resolveChatProvider, resolveEmbeddingProvider } from '@/lib/ai/providers';

interface QueryRow {
  [key: string]: unknown;
}

function makeSupabase(rows: {
  ai_model_configs?: QueryRow[];
  embedding_model_configs?: QueryRow[];
  ai_provider_configs?: QueryRow[];
}) {
  const tables = {
    ai_model_configs: rows.ai_model_configs ?? [],
    embedding_model_configs: rows.embedding_model_configs ?? [],
    ai_provider_configs: rows.ai_provider_configs ?? [],
  };

  class Query {
    private filters: Array<[string, unknown]> = [];
    private orderCol: string | null = null;
    private ascending = true;
    private limitN: number | null = null;

    constructor(private table: keyof typeof tables) {}

    select(_cols?: string) {
      return this;
    }

    eq(col: string, value: unknown) {
      this.filters.push([col, value]);
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.orderCol = col;
      this.ascending = opts?.ascending !== false;
      return this;
    }

    limit(n: number) {
      this.limitN = n;
      return this;
    }

    async maybeSingle() {
      let data = tables[this.table].filter((row) =>
        this.filters.every(([col, value]) => row[col] === value),
      );
      if (this.orderCol) {
        data = [...data].sort((a, b) => {
          const av = a[this.orderCol!] as string | number;
          const bv = b[this.orderCol!] as string | number;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (this.ascending ? 1 : -1);
        });
      }
      if (this.limitN != null) data = data.slice(0, this.limitN);
      return { data: data[0] ?? null };
    }
  }

  return {
    from(table: keyof typeof tables) {
      return new Query(table);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INTEGRATION_LIVE_PROVIDERS_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('AI provider runtime', () => {
  it('returns the seeded mock chat runtime when the active provider is mock', async () => {
    const supabase = makeSupabase({
      ai_model_configs: [
        {
          id: 'model-chat',
          tenant_id: 'tenant-1',
          provider_config_id: 'provider-chat',
          model_name: 'mock-chat-v1',
          max_input_tokens: 8000,
          max_output_tokens: 1500,
          temperature: 0.2,
          active: true,
          created_at: '2026-06-22T00:00:00Z',
        },
      ],
      ai_provider_configs: [
        {
          id: 'provider-chat',
          tenant_id: 'tenant-1',
          kind: 'chat',
          adapter: 'mock',
          vendor: 'mock',
          display_name: 'Mock chat',
          secret_ref: null,
          base_url: null,
          active: true,
          available: true,
        },
      ],
    });

    const runtime = await resolveChatProvider(supabase as never, 'tenant-1');
    const result = await runtime.provider.generate({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(runtime.available).toBe(true);
    expect(runtime.usingMock).toBe(true);
    expect(result.development).toBe(true);
  });

  it('blocks an external Anthropic chat provider when the env gate is off', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
    const supabase = makeSupabase({
      ai_model_configs: [
        {
          id: 'model-chat',
          tenant_id: 'tenant-1',
          provider_config_id: 'provider-chat',
          model_name: 'claude-sonnet-4-20250514',
          max_input_tokens: 8000,
          max_output_tokens: 1500,
          temperature: 0.2,
          active: true,
          created_at: '2026-06-22T00:00:00Z',
        },
      ],
      ai_provider_configs: [
        {
          id: 'provider-chat',
          tenant_id: 'tenant-1',
          kind: 'chat',
          adapter: 'external',
          vendor: 'anthropic',
          display_name: 'Anthropic prod',
          secret_ref: 'ANTHROPIC_API_KEY',
          base_url: null,
          active: true,
          available: true,
        },
      ],
    });

    const runtime = await resolveChatProvider(supabase as never, 'tenant-1');

    expect(runtime.available).toBe(false);
    expect(runtime.reason).toBe('runtime_flag_off');
    expect(runtime.usingMock).toBe(true);
  });

  it('uses the live Anthropic chat provider when env gating and secrets are present', async () => {
    process.env.INTEGRATION_LIVE_PROVIDERS_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
    anthropicCreate.mockResolvedValue({
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'Grounded draft reply' }],
      usage: { input_tokens: 111, output_tokens: 37 },
      stop_reason: 'end_turn',
    });

    const supabase = makeSupabase({
      ai_model_configs: [
        {
          id: 'model-chat',
          tenant_id: 'tenant-1',
          provider_config_id: 'provider-chat',
          model_name: 'claude-sonnet-4-20250514',
          max_input_tokens: 8000,
          max_output_tokens: 1500,
          temperature: 0.2,
          active: true,
          created_at: '2026-06-22T00:00:00Z',
        },
      ],
      ai_provider_configs: [
        {
          id: 'provider-chat',
          tenant_id: 'tenant-1',
          kind: 'chat',
          adapter: 'external',
          vendor: 'anthropic',
          display_name: 'Anthropic prod',
          secret_ref: 'ANTHROPIC_API_KEY',
          base_url: null,
          active: true,
          available: true,
        },
      ],
    });

    const runtime = await resolveChatProvider(supabase as never, 'tenant-1');
    const result = await runtime.provider.generate({
      messages: [
        { role: 'system', content: 'System rule' },
        { role: 'data', content: 'Approved facts' },
        { role: 'user', content: 'What is the price?' },
      ],
      maxOutputTokens: 300,
    });

    expect(runtime.available).toBe(true);
    expect(runtime.externalAvailable).toBe(true);
    expect(runtime.usingMock).toBe(false);
    expect(result.text).toBe('Grounded draft reply');
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it('uses the live OpenAI embedding provider when env gating and secrets are present', async () => {
    process.env.INTEGRATION_LIVE_PROVIDERS_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'openai-secret';
    openaiEmbeddingsCreate.mockResolvedValue({
      model: 'text-embedding-3-small',
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { total_tokens: 12 },
    });

    const supabase = makeSupabase({
      embedding_model_configs: [
        {
          id: 'model-embed',
          tenant_id: 'tenant-1',
          provider_config_id: 'provider-embed',
          model_name: 'text-embedding-3-small',
          dimensions: 3,
          active: true,
          created_at: '2026-06-22T00:00:00Z',
        },
      ],
      ai_provider_configs: [
        {
          id: 'provider-embed',
          tenant_id: 'tenant-1',
          kind: 'embedding',
          adapter: 'external',
          vendor: 'openai',
          display_name: 'OpenAI embeddings',
          secret_ref: 'OPENAI_API_KEY',
          base_url: null,
          active: true,
          available: true,
        },
      ],
    });

    const runtime = await resolveEmbeddingProvider(supabase as never, 'tenant-1');
    const result = await runtime.provider.embedQuery({ text: 'pool and gym' });

    expect(runtime.available).toBe(true);
    expect(runtime.externalAvailable).toBe(true);
    expect(runtime.usingMock).toBe(false);
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(openaiEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });
});
