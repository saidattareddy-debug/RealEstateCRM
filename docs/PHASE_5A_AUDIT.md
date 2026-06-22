# Phase 5A — Completion Audit & Remediation (evidence-based)

**Date:** 2026-06-20
**Method:** This audit was performed by inspecting the actual migrations,
services, routes, components, tests and SQL — not by trusting summary status or
test totals. Two issues flagged by the audit request were real and have been
**remediated** (BUILD_STATUS contradictions; canonical embedding storage). One
additional real bug was found and fixed during verification (FAQ chunk splitting).

---

## 0. Gates (final, this audit)

| Gate                                       | Result                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `pnpm format:check`                        | **PASS**                                                                                     |
| `pnpm lint`                                | **PASS — 0 errors**                                                                          |
| `pnpm typecheck`                           | **PASS**                                                                                     |
| `pnpm test` (Vitest)                       | **PASS — 201 (19 files)**                                                                    |
| Embedded-Postgres RLS + similarity harness | **PASS — 262 passed, 0 failed**                                                              |
| Migration apply `0001`–`0018` (clean DB)   | **PASS**                                                                                     |
| Migration-order validation                 | **PASS — 18 sequential**                                                                     |
| Secret scan                                | **PASS — provider keys used only as availability booleans; no service-role / `oc_` leakage** |
| `pnpm build` (production)                  | **PASS**                                                                                     |

> `pnpm install --frozen-lockfile` is the CI gate on a normal machine; the agent
> sandbox mount blocks `unlink`, so deps + gates run on a sandbox-local copy.
> Official `supabase db reset` + `supabase test db` (pgTAP) on a live project,
> and the pgvector `<=>` ANN path, remain **deferred** (no live project /
> embedded-Postgres has no pgvector). See §2.

## 1. BUILD_STATUS reconciliation (remediated)

Corrected in `docs/BUILD_STATUS.md`: the header no longer claims "complete"
during the audit; the interim status is set; the stale **"Phase 4.1 … (in
progress)"** detailed-report heading was corrected to "COMPLETE, locally
verified" with a dated status-correction note; the phase tracker shows 5A/5B
split; the gates line points to this report. Until this audit passes the status
is:

```text
Phase 5A — Completion Claimed, Audit Required
Phase 5B — Not Started
Live Supabase — Deferred
Production Verification — Pending
```

## 2. Embedding-storage decision (remediated → in-database similarity)

**Finding:** before remediation, `apps/web/src/lib/ai/retrieval.ts` loaded jsonb
embedding arrays into Node and computed cosine with `cosineSimilarity` over up to
400 rows, with no embedding-model-configuration filter (only an array-length
check). That is application-side array math — not acceptable as a canonical RAG
backend.

**Remediation — migration `0018_embedding_pgvector.sql` (forward-only; 0017 not
rewritten):**

- The canonical similarity is now computed **in the database** by
  `match_knowledge_chunks(p_project, p_query jsonb, p_model_config, p_dim,
p_limit)` — a `SECURITY INVOKER` SQL function (RLS applies) that filters to
  approved + in-effect chunks of the **selected embedding-model configuration**
  with **matching dimensions** _before_ any comparison (mixed-model isolation +
  dimension compatibility), then ranks by cosine similarity.
- **Where pgvector is installed** (production Supabase) the migration also adds a
  canonical `embedding extensions.vector` column, a `vector_dims = dimensions`
  CHECK (`kce_dim_match`), a trigger that keeps `embedding` in sync with the jsonb
  array the app writes, and a `<=>`-operator variant of the function — the
  performance/ANN path. The embedded-Postgres harness has **no pgvector**, so it
  exercises the portable in-SQL variant; the pgvector `<=>` path + an HNSW/IVFFlat
  ANN index (a fixed model/dimension on a live project) are the documented
  deferral (`docs/RAG_ARCHITECTURE.md`).
- The embedding row now preserves: tenant, project, chunk, embedding-model
  config, model name + version, dimension, distance metric, checksum,
  mock-provider status (`development`), created time, **superseded_at**, and
  **error_state**.
- `retrieval.ts` now resolves the active embedding-model config, embeds the query
  with the **same** provider, and calls `match_knowledge_chunks` via RPC — the
  app no longer compares vectors. `ingestion.ts` records the config id + model
  name + checksum + distance metric on every embedding.

**Harness evidence (`supabase/tests/local-harness/run.mjs`):** provenance columns
present; `cosine_sim_jsonb` computes in-DB cosine (identical=1, orthogonal=0);
`match_knowledge_chunks` ranks nearest-first; a different model config returns
nothing (mixed-model isolation); a dimension mismatch returns nothing; tenant B
cannot match tenant A's chunks (SECURITY INVOKER + RLS).

## 3. Exact inventory

**Migrations:** `0017_knowledge_ai_foundation.sql` (~38 tables, RLS, permissions,
audit actions, provisioning) + `0018_embedding_pgvector.sql` (in-DB similarity +
pgvector path).

**Services (`apps/web/src/lib/ai`):** `providers.ts`, `url-safety.ts`,
`ingestion.ts`, `retrieval.ts`, `tools.ts`, `orchestrator.ts`.

**Actions:** `app/(app)/knowledge/actions.ts`, `app/(app)/ai/actions.ts`,
`app/(app)/settings/ai/actions.ts`.

**Routes / pages:** `/knowledge`, `/knowledge/new`, `/knowledge/[sourceId]`,
`/knowledge/review`; `/settings/ai` (+ providers / models / prompts / policies /
usage); `/ai/test-lab`; inbox copilot panel (`inbox/[id]/copilot.tsx`).

**Domain (pure, unit-tested):** `ai-guard`, `chunking`, `ai-providers`,
`grounding`, `ai-escalation`, `knowledge`, `retrieval` (rerank), `prompt-injection`,
`ai-language`, `ai-cost`, `ai-eval`.

**Unit-test total: 201** (19 files). **Harness total: 262** (migrations 0001–0018).

## 4. Per-area results

| §     | Area                               | Result                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | Knowledge lifecycle                | **Pass**                               | `knowledge.ts` `canTransition`/`isRetrievable`/`canApprove`/`activateVersion` (unit); `knowledge/actions.ts` create/version/approve/reject/supersede/archive/rollback; harness approved-only + draft-excluded + expiry + cross-tenant. Approval writes `knowledge_approval_events`.                                                                                                                                                                                   |
| 4     | Ingestion pipeline                 | **Pass**                               | `ingestion.ts` 15-step pipeline (checksum→dedupe→normalize→injection-scan→chunk→embed→persist→review_required→audit); methods manual/markdown/faq/project_record/document_url; project-record imports map approved facts.                                                                                                                                                                                                                                             |
| 5     | Deterministic chunking             | **Pass**                               | `chunking.test.ts` (14 tests): reproducible checksums, headings, long prose, lists, **payment-plan atomic**, **FAQ pairs atomic** (bug fixed this pass), **price+currency+unit kept**, **text tables**, **en/hi/kn/ta/te/hinglish** scripts intact, empty, repeated, long URL.                                                                                                                                                                                        |
| 6     | Provider abstraction               | **Pass**                               | `ai-providers.ts` independent chat/embedding interfaces + deterministic mocks + `normalizeProviderError`; `lib/ai/providers.ts` env-keyed availability (booleans only); secret scan clean.                                                                                                                                                                                                                                                                            |
| 7     | Hybrid retrieval                   | **Pass (with noted provenance scope)** | `retrieval.ts` FTS + in-DB vector + exact-FAQ + deterministic `rerank`/dedup; harness cross-tenant/project + draft/rejected/superseded/archived/expired exclusion + model/dimension-mismatch filter (explicit per-state assertions). _Per-chunk objects carry chunk/source/source-version/lexical/vector/trust/recency/final-rank; tenant/project/correlation-id live on the `ai_retrieval_events` run row, not duplicated per chunk (documented in TECHNICAL_DEBT)._ |
| 8     | Dynamic tools                      | **Pass**                               | `tools.ts` allow-list `TOOL_REGISTRY` (10 read-only tools); `callTool` rejects unknown names; server-side tenant/project; freshness + `stale`/`approved` flags; no SQL/table injection, no mutation.                                                                                                                                                                                                                                                                  |
| 9     | Grounding                          | **Pass**                               | `grounding.ts` 7-decision deterministic (unit); evidence-based, not model confidence; orchestrator drafts only when `grounded`.                                                                                                                                                                                                                                                                                                                                       |
| 10    | Citations                          | **Pass (architectural isolation)**     | `orchestrator.ts` builds `ai_answer_citations` from the **reranked approved, in-scope** sources with `customerSafeReference` (no internal ids to customers). Wrong-project/tenant/superseded/redacted citations cannot arise because retrieval excludes those rows (harness-proven); claim-level "citation actually supports" verification is part of the eval harness scoring.                                                                                       |
| 11    | Conflict + escalation              | **Pass (conflict at decision layer)**  | `knowledge.ts` `detectConflicts`/`resolveConflict` (unit) + `knowledge_conflicts` table + `decideGrounding` returns `conflicting_evidence` when a conflict is present (blocks a grounded draft). `ai-escalation.ts` 14 categories (unit). _Inline claim-extraction during live retrieval is a documented follow-up; the decision-layer gate is in place._                                                                                                             |
| 12    | Prompt-injection defence           | **Pass**                               | `prompt-injection.ts` `detectInjection` (safe categories, unit) + `wrapUntrustedContext`; orchestrator keeps system instructions separate from wrapped data; tools allow-list + no arbitrary SQL/URL; `url-safety.ts` SSRF guard.                                                                                                                                                                                                                                     |
| 13    | AI execution boundary              | **Pass**                               | `ai-guard.ts` `evaluateAiExecution` (`maySendAutomatically: false` literal; automatic → `phase_5b_automatic_responder_not_enabled`); `ai_runs` CHECK `mode <> 'automatic'`; grep confirms no AI path inserts a message / delivery event / `waiting_on` / unread / status / lead / pipeline / score change. Unit + harness.                                                                                                                                            |
| 14–16 | Knowledge / Settings / Test-lab UI | **Pass**                               | routes build; permission-gated; `test-lab-client.tsx` shows "TEST MODE — NOT SENT" and only calls `runTestLab` (orchestrator, no send); settings never display secrets.                                                                                                                                                                                                                                                                                               |
| 17    | Shadow + Copilot                   | **Pass**                               | `shadow_sample_rate` stored on `ai_feature_policies`; `ai_copilot_drafts` status `generated`→`accepted/edited/discarded` (audited); `sendEditedDraft` delegates to `sendReplyAction` (re-runs reply/consent/DNC/status/takeover checks); draft never creates delivery events / changes waiting-on before manual send.                                                                                                                                                 |
| 18    | Evaluation dataset                 | **Pass**                               | seeded `ai_evaluation_*` (21 cases, all listed scenarios + 6 languages); `ai-eval.ts` scores evidence/citation/unsupported-claim/escalation/isolation/freshness/language — not text similarity (unit ×9; harness counts cases + language coverage).                                                                                                                                                                                                                   |
| 19    | Documentation                      | **Pass**                               | 7 new + PHASE_5A_AUDIT; 8 updated; this report reconciles BUILD_STATUS.                                                                                                                                                                                                                                                                                                                                                                                               |

## 5. Remaining technical debt (honest)

- Per-chunk retrieval result objects do not duplicate tenant/project/correlation-id
  (those are on the `ai_retrieval_events` run row); harmless, documented.
- Live retrieval does not yet compute claim-level conflicts inline (decision-layer
  conflict gating + `knowledge_conflicts` + `detectConflicts` are in place).
- pgvector `<=>` ANN index + a fixed production embedding model are deferred to a
  live Supabase project (embedded-Postgres has no pgvector).
- External chat/embedding adapters are server-only stubs until credentials exist.
- Phase 4.1 approved deferrals (project-authorization schema, per-conversation SLA
  override, last-widget-config timestamp) remain preserved in `TECHNICAL_DEBT.md`.

## 6. Phase 5B readiness decision

**Ready for review.** Every required Phase 5A feature is evidenced; the two
flagged defects and one discovered bug are remediated; all nine gates pass. The
AI execution boundary makes automatic customer sending impossible. Phase 5B
(customer-facing AI answering) remains **NOT started** and requires a production
responder routed through `evaluateAiExecution`, real server-only provider
credentials, the pgvector ANN path on a live project, and its own exit criteria.

---

```text
Phase 5A — Locally Complete and Verified
Phase 5B — Ready for Review
Live Supabase — Deferred
Production Verification — Pending
```
