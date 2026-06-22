import 'server-only';
import {
  createMockChatProvider,
  createMockEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from '@re/domain';
import { getServerEnv } from '@re/config';

/**
 * Server-only AI provider factory (Phase 5A §8–9).
 *
 * SAFETY:
 *  - Provider credentials are read ONLY from `getServerEnv()` and are never
 *    returned to the browser, logged, embedded in prompts, or put into audit
 *    metadata. This module exports providers and a boolean availability map —
 *    never a key value.
 *  - When no relevant credential is configured, the deterministic MOCK provider
 *    is returned and the external provider is reported unavailable. We never
 *    fake a successful external connection.
 *
 * External adapters are intentionally NOT implemented here in Phase 5A: there is
 * no customer-facing AI sending, so wiring a live network adapter is out of
 * scope and would be the only place a real key could leak. The presence of a
 * key only flips the availability flag; the returned provider stays the mock
 * until a vetted server-side adapter is added in a later phase. This keeps the
 * "secrets never reach the browser / never sent to a customer" invariant trivial
 * to prove. The default mock embedding dimension matches the seeded
 * `mock-embed-v1` model (16) in migration 0017.
 */

const MOCK_EMBED_DIMENSIONS = 16;

/** Whether an external credential exists for each provider kind. No values. */
export function providerAvailability(): { chat: boolean; embedding: boolean } {
  const env = getServerEnv();
  // A chat credential = any chat-capable provider key present.
  const chat = Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY);
  // Embeddings come from OpenAI or Gemini in this stack.
  const embedding = Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY);
  return { chat, embedding };
}

/**
 * Return the chat provider. Always the deterministic mock in Phase 5A.
 * (External availability is surfaced via `providerAvailability().chat` for the
 * settings UI, but no live adapter is wired until a later phase.)
 */
export function getChatProvider(): ChatProvider {
  return createMockChatProvider();
}

/** Return the embedding provider. Always the deterministic mock in Phase 5A. */
export function getEmbeddingProvider(
  dimensions: number = MOCK_EMBED_DIMENSIONS,
): EmbeddingProvider {
  return createMockEmbeddingProvider(dimensions);
}

/** True when only the deterministic mock is in use (no live external adapter). */
export function usingMockProviders(): boolean {
  // Phase 5A never wires a live adapter, so this is always true. Kept as a
  // function so call sites and the run trace can record provider status.
  return true;
}
