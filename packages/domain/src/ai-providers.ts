/**
 * Provider-neutral AI interfaces (Phase 5A §8–9). Pure types + a deterministic
 * mock implementation used by tests and by local development when no external
 * credential is configured. Real adapters live in the app layer (server-only)
 * and implement the same interfaces — business logic never hardcodes a provider.
 *
 * Credentials are NEVER part of these types: adapters read them from the server
 * environment. Nothing here is logged, embedded in prompts, or returned to the
 * browser.
 */

import { fnv1aHex } from './chunking';

// --- Embeddings ------------------------------------------------------------

export interface EmbeddingInput {
  text: string;
  correlationId?: string;
}

export interface EmbeddingResult {
  vector: number[];
  dimensions: number;
  modelVersion: string;
  /** True when produced by the deterministic dev/mock provider. */
  development: boolean;
  tokensUsed: number;
}

export interface EmbeddingProvider {
  embedDocuments(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]>;
  embedQuery(input: EmbeddingInput): Promise<EmbeddingResult>;
}

// --- Chat ------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'data';
  content: string;
}

export interface ChatGenerationRequest {
  messages: ChatMessage[];
  maxOutputTokens?: number;
  correlationId?: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatGenerationResult {
  text: string;
  usage: ChatUsage;
  modelVersion: string;
  development: boolean;
  finishReason: 'stop' | 'length' | 'error';
}

export interface ChatProvider {
  generate(request: ChatGenerationRequest): Promise<ChatGenerationResult>;
}

// --- Error normalization ---------------------------------------------------

export type ProviderErrorCategory =
  | 'timeout'
  | 'rate_limited'
  | 'auth'
  | 'invalid_request'
  | 'server'
  | 'unavailable'
  | 'unknown';

export interface NormalizedProviderError {
  category: ProviderErrorCategory;
  retryable: boolean;
  /** Safe, non-sensitive summary (never the raw provider payload/credentials). */
  summary: string;
}

const RETRYABLE: ReadonlySet<ProviderErrorCategory> = new Set([
  'timeout',
  'rate_limited',
  'server',
  'unavailable',
]);

/** Map an arbitrary provider error (status/code/message) to a safe category. */
export function normalizeProviderError(err: {
  status?: number;
  code?: string;
  message?: string;
}): NormalizedProviderError {
  const code = (err.code ?? '').toLowerCase();
  const status = err.status ?? 0;
  let category: ProviderErrorCategory = 'unknown';
  if (code.includes('timeout') || code === 'etimedout' || status === 408) category = 'timeout';
  else if (status === 429 || code.includes('rate')) category = 'rate_limited';
  else if (status === 401 || status === 403 || code.includes('auth')) category = 'auth';
  else if (status === 400 || status === 422) category = 'invalid_request';
  else if (status >= 500 && status < 600) category = 'server';
  else if (status === 503 || code.includes('unavailable') || code === 'econnrefused')
    category = 'unavailable';
  return {
    category,
    retryable: RETRYABLE.has(category),
    // Deliberately generic — no credential/payload leakage.
    summary: `provider_error:${category}`,
  };
}

// --- Deterministic mock providers ------------------------------------------

/**
 * Deterministic embedding provider: a stable pseudo-vector derived from the
 * text hash. Same text → same vector, so retrieval tests are reproducible.
 * Clearly marked `development: true`; never use its output as a real embedding.
 */
export function createMockEmbeddingProvider(dimensions = 16): EmbeddingProvider {
  const embed = (text: string): EmbeddingResult => {
    const vector: number[] = [];
    let seed = parseInt(fnv1aHex(text), 16) || 1;
    for (let i = 0; i < dimensions; i++) {
      // xorshift32 for a deterministic [-1,1] component.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      vector.push(((seed >>> 0) / 0xffffffff) * 2 - 1);
    }
    return {
      vector,
      dimensions,
      modelVersion: 'mock-embed-v1',
      development: true,
      tokensUsed: Math.ceil(text.length / 4),
    };
  };
  return {
    async embedDocuments(inputs) {
      return inputs.map((i) => embed(i.text));
    },
    async embedQuery(input) {
      return embed(input.text);
    },
  };
}

/**
 * Deterministic chat provider for tests / local dev. It does NOT answer
 * questions — it echoes a clearly-labelled development stub, so no test can
 * mistake it for a real grounded answer.
 */
export function createMockChatProvider(): ChatProvider {
  return {
    async generate(request) {
      const last = request.messages[request.messages.length - 1]?.content ?? '';
      const inputTokens = request.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
      const text = `[development-draft] (mock) re: ${last.slice(0, 80)}`;
      return {
        text,
        usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) },
        modelVersion: 'mock-chat-v1',
        development: true,
        finishReason: 'stop',
      };
    },
  };
}

/** Cosine similarity for ranking (pure). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
