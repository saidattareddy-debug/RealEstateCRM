# Grounding Policy

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §12 and built in Phase 5A. Grounding is the deterministic gate between _retrieved evidence_ and _a draft answer_. It answers one question: given the approved evidence we actually retrieved, may we draft an answer, and if not, why not? The decision is computed from evidence alone — **it never relies on a model's self-reported confidence**. The pure logic lives in [`packages/domain/src/grounding.ts`](../packages/domain/src/grounding.ts).

Companion docs: [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) (how evidence is gathered) and [`AI_ESCALATION.md`](./AI_ESCALATION.md) (what happens when grounding fails).

---

## 1. The seven decisions

`decideGrounding(evidence)` returns exactly one `GroundingDecision`:

| Decision                | Meaning                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `grounded`              | Sufficient approved evidence with complete citation coverage. A draft answer may be produced. |
| `insufficient_evidence` | Some evidence, but below the strength threshold or missing required citation coverage.        |
| `conflicting_evidence`  | Approved sources make incompatible claims; resolve before answering.                          |
| `stale_dynamic_data`    | Dynamic operational data (e.g. inventory) is out of date; verify before confirming.           |
| `unsupported_question`  | A project-specific question with no approved evidence and no structured tool result.          |
| `policy_blocked`        | A policy block applies (e.g. a guaranteed-return / legal request).                            |
| `human_review_required` | Language cannot be served, or project scope does not match the evidence.                      |

## 2. Evidence inputs

The decision is a pure function of a `GroundingEvidence` record assembled by `buildGroundingEvidence()` (`apps/web/src/lib/ai/retrieval.ts`) from the retrieval and tool results:

- `relevantApprovedSources` — count of independent approved sources judged relevant;
- `topRelevance` — best retrieval score in [0,1];
- `exactFaqMatch` — an exact approved-FAQ hit;
- `structuredToolEvidence` — a read-only dynamic tool returned verified, approved, non-stale data;
- `conflictDetected` — a conflict was found among the evidence;
- `dynamicDataStale` — dynamic data (inventory/price) is stale;
- `projectSpecific` / `projectScopeMatch` — whether the question is project-specific and whether the answer scope matched the evidence;
- `languageSupported` — the requested language can be served (native or allowed fallback);
- `policyBlocked` — a policy block applies;
- `citationCoverageComplete` — every required citation category is covered.

## 3. Decision order

The function evaluates in a fixed precedence so the outcome is deterministic:

1. `policyBlocked` → `policy_blocked`.
2. language unsupported → `human_review_required`.
3. project-specific but scope mismatch → `human_review_required`.
4. conflict detected → `conflicting_evidence`.
5. dynamic data stale → `stale_dynamic_data`.
6. otherwise evaluate evidence strength: an exact FAQ match, structured tool evidence, **or** (`relevantApprovedSources ≥ minRelevantSources` and `topRelevance ≥ minTopRelevance`). Defaults are 1 source and 0.45 relevance.
   - If evidence is weak and the question is project-specific with zero approved sources and no tool evidence → `unsupported_question`; otherwise → `insufficient_evidence`.
   - If evidence is strong but citation coverage is incomplete → `insufficient_evidence`.
   - Otherwise → `grounded`.

## 4. A draft only when grounded

`mayDraftAnswer(decision)` returns true only for `grounded`. The orchestrator drafts a real answer only in that case; for every other decision it produces an explicit escalation note (`"[escalation:<category>] <suggested action>"`), never a guessed answer. This is the operational form of the "grounded or silent" tenet ([`AI_SYSTEM.md`](./AI_SYSTEM.md) §1).

## 5. Citations

A grounded draft must be citable. Required citation categories are tracked per evaluation case and per source type, and `citationCoverageComplete` must hold for `grounded` — a strong-but-uncited answer is downgraded to `insufficient_evidence`. Citations are surfaced to the agent as **customer-safe references** (e.g. "Project brochure", "Current inventory record"), never internal ids, storage URLs, or chunk text (`ai_answer_citations.customer_safe_reference`).

## 6. Dynamic data and inventory freshness

Inventory, price, offers and similar facts come from read-only structured tools, not from static knowledge. When a tool reports data older than the freshness window (24h for inventory) or a project that is unapproved/empty, the result is marked `stale`/not-approved. The orchestrator treats this as `dynamicDataStale`, grounding returns `stale_dynamic_data`, and the system **escalates rather than asserting** availability or price — protecting against confidently confirming a unit that may already be sold. `evidenceSufficiency()` likewise subtracts for staleness and conflicts so the sufficiency score reflects reality.
