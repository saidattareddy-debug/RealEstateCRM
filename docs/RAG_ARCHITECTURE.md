# RAG Architecture

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §7, §10–12 and built in Phase 5A. This document describes the retrieval-augmented pipeline that turns a customer question plus approved knowledge into a **grounded, citable, agent-facing draft** — never an automatically-sent message. It covers deterministic chunking, model-agnostic embeddings, hybrid retrieval, deterministic rerank/dedup/sufficiency, tenant/project scoping, and how the orchestrator assembles everything.

Companion docs: [`KNOWLEDGE_SYSTEM.md`](./KNOWLEDGE_SYSTEM.md) (what is retrievable), [`AI_PROVIDERS.md`](./AI_PROVIDERS.md) (the provider abstraction), [`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md) (the decision), [`AI_ESCALATION.md`](./AI_ESCALATION.md), and [`AI_SECURITY.md`](./AI_SECURITY.md).

---

## 1. Deterministic chunking

Chunking is pure and reproducible: identical input + config always yields identical chunks and checksums (`packages/domain/src/chunking.ts`). The rules protect the integrity of real-estate facts:

- Prefer semantic sections (markdown headings); never mix headings across chunks.
- Preserve FAQ question/answer pairs as single chunks.
- Never split inside a paragraph, list item, or table-row line — so a price stays with its unit and conditions, and payment-plan steps stay intact.
- An over-long single token (e.g. a URL) is emitted whole, never broken.

Each chunk gets a stable FNV-1a checksum over `heading|text`, a deterministic character offset, and a token estimate. Text is normalized first (line endings, trailing whitespace, blank-run collapse) so checksums are stable across cosmetic input differences.

## 2. Embeddings — model-agnostic, DB-side similarity (post-migration 0018)

Embeddings are produced by an `EmbeddingProvider` ([`AI_PROVIDERS.md`](./AI_PROVIDERS.md)) and stored in `knowledge_chunk_embeddings.vector` as a model-agnostic **`jsonb` array**, alongside `dimensions`, `model_version` / `model_name`, `project_id`, `distance_metric`, and a `checksum`. A tenant can switch embedding models without a schema migration.

The actual implementation after migration `0018_embedding_pgvector.sql` is:

- **Canonical similarity lives in the database**, not in application code. `match_knowledge_chunks(...)` runs `SECURITY INVOKER` (so the caller's tenant + project RLS applies), filters to approved + in-effect chunks of the **selected embedding-model configuration with matching dimensions** _before_ any comparison (mixed-model isolation + dimension compatibility), and computes cosine similarity in SQL. The earlier "load jsonb arrays into Node and compute cosine in application code" path is removed.
- **pgvector is the production path.** Where the `vector` extension is available (production Supabase), the migration also adds a canonical pgvector `embedding` column with a dimension-match CHECK, a trigger keeping it in sync with the jsonb array the application writes, and a `<=>`-based variant of the function — the performance/ANN path.
- **Portable fallback for the harness.** The embedded-Postgres test harness has no pgvector, so it exercises a portable in-SQL cosine (`cosine_sim_jsonb`) over the jsonb arrays. The pgvector `<=>` path is verified on a live project (a sanctioned deferral — see [`TECH_DEBT.md`](./TECH_DEBT.md)).
- **Retrieval is exact** over the scoped candidate set; an **ANN index (IVFFlat / HNSW) is an optional, benchmark-driven performance gate**, not a correctness gate, enabled on a live project once a model + dimension are fixed (see [`DEPLOYMENT.md`](./DEPLOYMENT.md)).

In Phase 5A the embedding provider is the deterministic mock (16-dim), so retrieval tests are reproducible.

## 3. Hybrid retrieval

`retrieveKnowledge()` (`apps/web/src/lib/ai/retrieval.ts`) blends four independent retrieval signals over the already-scoped candidate set:

1. **Lexical (FTS).** PostgreSQL full-text search against the `content_tsv` generated column (`tsvector`, `simple` config), backed by a GIN index. Run via Supabase `.textSearch(..., { type: 'plain', config: 'simple' })`.
2. **Vector similarity.** The query is embedded and compared against scoped chunk embeddings of the same dimension using cosine similarity; positive-similarity hits are kept and ranked.
3. **Exact FAQ match.** A case-insensitive match of the query against the question line of approved FAQ chunks — a high-confidence, citable signal.
4. **Structured tools.** Read-only dynamic tools that return current project facts (inventory, price range, offers, etc.) — see §5 and [`AI_SECURITY.md`](./AI_SECURITY.md) §4.

## 4. Deterministic rerank, dedup, and sufficiency

The lexical + vector candidates are merged by chunk id into a `Candidate[]` and reranked by the pure `rerank()` function (`packages/domain/src/retrieval.ts`). The combined score is a weighted blend — lexical 0.35, vector 0.40, trust 0.15, recency 0.10, plus an exact-FAQ boost of 0.25 — with a mild cross-language penalty (×0.85) when the candidate language differs from the query language. Sorting is fully deterministic (score desc, then trust desc, then chunk id asc). Near-duplicate chunks are removed by Jaccard token overlap (≥0.90 keeps only the higher-ranked one), and the result set is capped at the configured limit.

From the ranked set the pipeline computes:

- **`independentSources`** — distinct approved _sources_ represented (not chunks), via `independentSourceCount()`.
- **`exactFaqMatch`** — whether any exact FAQ hit survived.
- **`sufficiency`** — a [0,1] evidence score: +0.5 exact FAQ, plus `min(0.4, independentSources × 0.15)`, plus `min(0.3, topScore × 0.3)`.

These feed the grounding decision; **nothing here trusts a model's self-reported confidence** ([`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md)).

## 5. Tenant and project scoping

The candidate set is hard-filtered at the SQL/RLS layer before any ranking happens. The shared `approvedChunkQuery` applies:

- `state = 'approved'` only;
- **project scope** — if the conversation has a `project_id`, match that project _or_ tenant-global (`project_id is null`); otherwise match tenant-global only;
- **effective window** — `effective_at is null or effective_at <= now` and `expires_at is null or expires_at >= now`.

Everything runs under the caller's RLS client, so draft/rejected/superseded/expired/redacted/cross-tenant/cross-project knowledge is never returned — this is the retrievability invariant from [`KNOWLEDGE_SYSTEM.md`](./KNOWLEDGE_SYSTEM.md) §8.

## 6. Language routing

Before retrieval, the query language is detected (`detectLanguage()` — by Unicode script plus a Hinglish heuristic) and routed (`routeLanguage()`). Routing prefers approved native-language knowledge; Hinglish can be served by Hindi or English native sources; English fallback is used only when policy allows. When no acceptable language is available, the request escalates (`unsupported_language`) rather than answering in the wrong language. Machine-translated sources are never treated as native ([`KNOWLEDGE_SYSTEM.md`](./KNOWLEDGE_SYSTEM.md) §7).

## 7. Orchestration flow

`runAiAnswer()` (`apps/web/src/lib/ai/orchestrator.ts`) is the server-only assembly point. It produces an agent-facing draft and a full audit trace and **never sends a customer message or mutates conversation state**. The order is fixed:

```
question
   │
   ▼
[1] evaluateAiExecution  ── gate: disabled/shadow/copilot only; automatic always denied;
   │                              maySendAutomatically is the literal false
   ▼
[2] language route       ── detectLanguage → routeLanguage (native / English fallback / escalate)
   │
   ▼
[3] usage limits         ── checkUsage + clampFanout (retrieval/tool fan-out caps, no retry storms)
   │
   ▼
[4] retrieval            ── FTS + vector + exact-FAQ  ──►  rerank / dedup  ──►  sufficiency
   │
   ▼
[5] dynamic tools        ── read-only allow-list (project facts);
   │                          stale/unapproved data sets staleDynamicData / lowers evidence
   ▼
[6] grounding            ── buildGroundingEvidence → decideGrounding (deterministic; no model self-report)
   │
   ▼
[7] escalation           ── decideEscalation (category + priority + suggested action)
   │
   ├─ grounded ─────────► draft answer  ── system instructions kept separate from
   │                          wrapUntrustedContext-wrapped data; chat.generate(); build citations
   │
   └─ not grounded ─────► escalation note  ── "[escalation:<category>] <suggested action>" (never a guess)
   │
   ▼
[8] persistRun           ── ai_runs (mode never 'automatic') + retrieval/tool/grounding/
                              escalation/citation traces — ids + safe summaries only
```

A real answer draft is produced **only when grounding is `grounded`** and the execution gate permitted drafting; otherwise the orchestrator emits an explicit escalation note. Either way, `maySendAutomatically` is the literal `false`, and sending an edited copilot draft is a separate, human-initiated action through the normal reply path (consent/DNC/status re-checked). See [`AI_SECURITY.md`](./AI_SECURITY.md) for the full no-send boundary.
