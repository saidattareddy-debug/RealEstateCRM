# AI Providers

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §8–9 and built in Phase 5A. This document describes the provider-neutral AI abstraction: independent chat and embedding providers, a deterministic mock that is the default in Phase 5A, the env-gated path for external providers, error normalization and usage accounting, and the hard rule that **provider credentials are server-only and never reach the browser, a log, an audit row, or a prompt**.

Companion docs: [`AI_SECURITY.md`](./AI_SECURITY.md) (the safety boundary) and [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) (where embeddings and chat are used).

---

## 1. Provider-neutral interfaces

Business logic never hardcodes a vendor. The pure interfaces live in `packages/domain/src/ai-providers.ts`:

- **`EmbeddingProvider`** — `embedDocuments(inputs)` and `embedQuery(input)`, each returning a `vector`, `dimensions`, `modelVersion`, a `development` flag, and `tokensUsed`.
- **`ChatProvider`** — `generate(request)` returning `text`, `usage` (`inputTokens`/`outputTokens`), `modelVersion`, a `development` flag, and a `finishReason`.

Chat and embedding are **independent**: a tenant can configure a chat provider and an embedding provider separately, with different vendors, through the settings UI (`ai_provider_configs.kind` is `chat` or `embedding`). Models are described per provider in `ai_model_configs` (chat) and `embedding_model_configs` (embedding, with a fixed `dimensions`).

## 2. Mock by default

Phase 5A ships **deterministic mock providers** as the default for every tenant (provisioned automatically — see [`DATABASE.md`](./DATABASE.md)):

- The mock embedding provider derives a stable pseudo-vector from the text hash, so the same text always produces the same vector and retrieval tests are reproducible. Default 16 dimensions, matching the seeded `mock-embed-v1` model.
- The mock chat provider does **not** answer questions — it echoes a clearly-labelled `[development-draft]` stub so no test or operator can mistake it for a real grounded answer.

Both are marked `development: true` in their results. The app-layer factory (`apps/web/src/lib/ai/providers.ts`) returns the mock for both chat and embedding in Phase 5A regardless of configuration; `usingMockProviders()` is always true.

## 3. External providers — env-gated stubs

External adapters (Anthropic, OpenAI, Gemini) are **wired as stubs in Phase 5A**: the abstraction and gating exist, but no live external call is made. Availability is a boolean derived purely from server environment keys read through `getServerEnv()`:

- chat availability is true when any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` is present;
- embedding availability is true when `OPENAI_API_KEY` or `GEMINI_API_KEY` is present.

All three keys are **optional**. The presence of a key only flips the availability flag for the settings UI; the returned provider stays the mock in 5A. A provider config row stores only a `secret_ref` — the **name** of a server-side env var (validated as `UPPER_SNAKE_CASE`), never the secret value — and external providers stay `available = false` until a real credential is wired. The system never fakes a successful external connection.

## 4. Error normalization

`normalizeProviderError()` maps an arbitrary provider error (status/code/message) to a safe category: `timeout`, `rate_limited`, `auth`, `invalid_request`, `server`, `unavailable`, or `unknown`. It returns whether the category is retryable (`timeout`, `rate_limited`, `server`, `unavailable`) and a deliberately generic `summary` of the form `provider_error:<category>` — **no credential or raw payload ever leaks** into the summary, a log, or an audit row.

## 5. Usage accounting

Token usage flows from each provider result into deterministic cost/limit logic (`packages/domain/src/ai-cost.ts`, see [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) §7 step 3). `checkUsage()` enforces per-request input/output caps and tenant daily/monthly and per-conversation token limits; `clampFanout()` bounds retrieval and tool fan-out; `mayRetry()` caps retries (no retry storms); a circuit breaker opens after consecutive provider failures. `estimateCostMicros()` produces a deterministic per-run cost estimate stored on `ai_runs.estimated_cost_micros`. Limits default from `ai_usage_limits` and are configurable per tenant.

## 6. The credentials rule

Credentials are **never** part of the domain interfaces, never returned to the browser, never logged, never embedded in a prompt, and never placed in audit metadata. Adapters read secrets only from the server environment, by the env-var name recorded in `secret_ref`. The audit trail records only a `secretRefPresent` boolean for provider changes, never the value (`ai.provider.updated`). See [`AI_SECURITY.md`](./AI_SECURITY.md) §2 and [`SECURITY.md`](./SECURITY.md).
