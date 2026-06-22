# Knowledge System

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §4–5, §14 and built in Phase 5A. This document describes the tenant-isolated, project-aware knowledge model that backs grounded AI answering: how knowledge is sourced, versioned, reviewed, approved, expired, and — above all — the rule that **only approved, in-effect, in-scope knowledge is ever retrievable**. The schema lives in [`supabase/migrations/0017_knowledge_ai_foundation.sql`](../supabase/migrations/0017_knowledge_ai_foundation.sql); the pure lifecycle logic lives in [`packages/domain/src/knowledge.ts`](../packages/domain/src/knowledge.ts).

It is companion to [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) (how knowledge is retrieved), [`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md) (how retrieved evidence becomes a decision), and [`AI_SECURITY.md`](./AI_SECURITY.md) (the safety boundary around it).

---

## 1. Design principles

- **Approved or invisible.** A knowledge entry has no influence on answering until a human approves it. Drafts, rejected, superseded, expired, and machine-translated-but-unapproved entries are filtered out at retrieval — enforced both in pure domain logic and again at the SQL/RLS layer.
- **Untrusted at the door.** Ingested document and customer text is reference data, never instructions. Every ingested source is scanned for prompt-injection before it can be approved (see [`AI_SECURITY.md`](./AI_SECURITY.md) §3).
- **Versioned and reversible.** Every source carries an immutable version history. Editing creates a new version; approval and rollback are explicit, reasoned, audited actions.
- **Tenant- and project-scoped.** Every knowledge row carries `tenant_id`; most carry an optional `project_id`. A `null` project means tenant-global knowledge; a set project means project-specific knowledge. Retrieval never crosses tenant or unrelated-project boundaries.

## 2. Source types

A knowledge **source** is the unit of authorship and approval. Its `source_type` (enum `knowledge_source_type`) tells the system what kind of facts it carries and feeds the customer-safe citation label shown to agents. The supported types are:

`project_overview`, `approved_faq`, `brochure`, `floor_plan`, `amenity`, `location`, `payment_plan`, `offer`, `policy`, `sales_script`, `legal_disclaimer`, `manual`, `imported_facts`, `general_guidance`.

Each source also records `language` (default `en`), a `trust_priority` (0–100, default 50), an owner, optional `effective_at`/`expires_at` window, a `machine_translated` flag, and retention/redaction controls (`retention_until`, `redacted_at`).

## 3. The eight-state lifecycle

Every source — and every chunk derived from it — moves through a fixed state machine (`knowledge_state`). The transitions are enforced by `canTransition()` in `packages/domain/src/knowledge.ts`:

| State             | Meaning                                               | Allowed next states                                               |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `draft`           | Created, not yet processed for review.                | `processing`, `review_required`, `rejected`, `archived`, `failed` |
| `processing`      | Ingestion pipeline running (extract → chunk → embed). | `review_required`, `failed`, `archived`                           |
| `review_required` | Processed and awaiting a human approval decision.     | `approved`, `rejected`, `archived`, `failed`                      |
| `approved`        | Human-approved and (within its window) retrievable.   | `superseded`, `archived`                                          |
| `rejected`        | Reviewer declined; never retrievable.                 | `draft`, `archived`                                               |
| `superseded`      | Replaced by a newer approved version.                 | `archived`                                                        |
| `archived`        | Terminal; permanently out of retrieval.               | —                                                                 |
| `failed`          | Ingestion failed (e.g. extraction error).             | `draft`, `archived`                                               |

Ingested sources always land in `review_required` — the pipeline never auto-approves. Approval is the only path from `review_required` to `approved`.

## 4. Versioning and rollback

Each source has a `knowledge_source_versions` history (monotonic `version`, with `change_summary`, `approval_reason`, approver, timestamp). Documents and chunks similarly carry version rows (`knowledge_document_versions`, and the `source_version_id` on chunks). Editing an approved source means **drafting a new version** in `review_required`, not mutating the live one.

Activating a new version supersedes the previous active one (`activateVersion()` returns `{ activate, supersede }`). **Rollback is not a special destructive operation — it is simply approving an older version as a new active version**, which supersedes whatever is currently live. This keeps the audit trail linear and every live state attributable to an approval event.

## 5. Approval rules

Approval is gated by the pure `canApprove()` function and re-checked in the `approveSource` server action. All four conditions must hold:

1. **State** must be `review_required`.
2. **Extraction complete** — the document text must have been extracted/normalized (`extraction_status`).
3. **No unresolved injection flag** — if any document version is `injection_flagged`, approval is blocked (`injection_unresolved`).
4. **Approver + reason** — an approver identity and a non-empty approval reason are both required.

The database backs this up: the `knowledge_sources` table carries `check (state <> 'approved' or (approved_by is not null and approved_at is not null))`, so an approved row can never exist without an approver and approval time. Each transition is recorded in `knowledge_approval_events` (`from_state`, `to_state`, actor, reason) and mirrored to the audit log (`knowledge.approved`, `knowledge.rejected`, `knowledge.superseded`, `knowledge.archived`).

## 6. Trust priority and conflict handling

`trust_priority` (0–100) ranks sources when more than one is relevant; it also feeds retrieval reranking ([`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md)). When two approved sources make incompatible claims (price, possession date, amenity, unit area, payment plan, offer, location distance), `detectConflicts()` groups claims by type and flags a conflict whenever ≥2 distinct values appear. A conflict is **ambiguous** when the top-trust claims still disagree. `resolveConflict()` will only auto-resolve when policy prefers structured data **and** there is a unique highest-trust claim; otherwise the conflict is surfaced for human resolution in `knowledge_conflicts` (resolved via `knowledge.conflicts.resolve`). At answer time, a detected conflict forces an escalation rather than a guess (see [`GROUNDING_POLICY.md`](./GROUNDING_POLICY.md)).

## 7. Effective window, expiry, and machine translation

Retrievability is time-bounded. The pure `isRetrievable()` guard returns true only when **all** of the following hold:

- `state === 'approved'`;
- the source is not a machine-translated-but-unapproved entry (`machineTranslatedUnapproved` is false);
- `now >= effective_at` (or `effective_at` is null);
- `now <= expires_at` (or `expires_at` is null).

Machine-translated sources are explicitly labelled (`machine_translated` boolean) and are never silently presented as native-language knowledge; language routing prefers native approved sources and only falls back to English where policy allows ([`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) §6).

## 8. The retrievability invariant

The central rule of the whole system: **only `approved` + in-effect (within the effective/expiry window) + in-scope (matching tenant, and the conversation's project or tenant-global) knowledge may ever be returned to the answering pipeline.** This is enforced in three independent layers:

1. **Domain** — `isRetrievable()` returns false for any non-approved or out-of-window state.
2. **SQL** — the retrieval query (`apps/web/src/lib/ai/retrieval.ts`) hard-filters `state = 'approved'`, applies the project/tenant-global scope, and bounds the effective/expiry window.
3. **RLS** — `idx_knowledge_chunks_approved` is a partial index over approved chunks only, and every knowledge table has tenant-scoped row-level security, so cross-tenant or non-approved rows are unreachable even by a buggy query.

## 9. Tables involved

| Table                                                 | Role                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `knowledge_sources`                                   | The source of record: type, scope, state, trust, window, approver.                                |
| `knowledge_source_versions`                           | Immutable version history with approval reason.                                                   |
| `knowledge_documents` / `knowledge_document_versions` | Extracted/normalized text per source version; carries `injection_flagged`/`injection_categories`. |
| `knowledge_chunks`                                    | Deterministic chunks with `content_tsv` (FTS), trust, window, state, checksum.                    |
| `knowledge_chunk_embeddings`                          | Model-agnostic `jsonb` embedding vectors per chunk.                                               |
| `knowledge_approval_events`                           | Append-only state-transition log (from/to/actor/reason).                                          |
| `knowledge_conflicts`                                 | Detected/resolved cross-source conflicts.                                                         |
| `knowledge_ingestion_jobs` / `_attempts` / `_errors`  | Durable, idempotent ingestion bookkeeping.                                                        |

See [`DATABASE.md`](./DATABASE.md) for the full column-level catalog and [`AI_SYSTEM.md`](./AI_SYSTEM.md) for where this fits in the larger AI design.
