# AI Security

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §15, §24, §26–27 and built in Phase 5A. This document describes the safety model around the AI subsystem: the central execution boundary that makes automatic customer sends impossible, prompt-injection defence, SSRF prevention on URL ingestion, the read-only dynamic-tool allow-list, the no-hidden-reasoning rule, audit discipline, and tenant/project isolation. It is the AI-specific extension of [`SECURITY.md`](./SECURITY.md).

---

## 1. The central execution boundary — no automatic send

Every AI execution path consults a single boundary: `evaluateAiExecution()` in [`packages/domain/src/ai-guard.ts`](../packages/domain/src/ai-guard.ts). There are no scattered AI checks elsewhere. Its invariants, proven by tests:

- **Four operating levels** — `disabled`, `shadow`, `copilot`, `automatic`. Only the first three are permitted in Phase 5A.
- **`automatic` is always denied** — an `automatic` request short-circuits with the reason `phase_5b_automatic_responder_not_enabled` before any other gate. No combination of database flags or browser inputs can authorise it. (A separate compile-time constant, `AI_RESPONDER_INSTALLED = false`, ensures even a fully-configured tenant cannot execute the legacy automated-reply path.)
- **`maySendAutomatically` is the literal `false`** — typed as the literal, returned unconditionally for every level and every input. Drafting (shadow/copilot) is gated separately and **never** authorises a send.

Because of this boundary the orchestrator (`apps/web/src/lib/ai/orchestrator.ts`) and every AI server action **never**: insert a `conversation_message`, deliver a message, change `waiting_on`/`unread`/`ai_active`/`operating_mode`, or otherwise mutate conversation state. The database backs the boundary up: `ai_runs` carries `check (mode <> 'automatic')`, so an automatic run can never even be recorded.

Sending an edited copilot draft is a **separate, human-initiated action** routed entirely through the normal reply path (`sendReplyAction`), which independently re-checks reply permission, conversation status, consent, do-not-contact, and human-takeover. There is no AI-initiated send path. Customer-facing AI answering (the Phase 5B automatic responder) stays disabled.

## 2. Secrets are server-only

Provider credentials never reach the browser, a log, an audit row, or a prompt. Configuration stores only a `secret_ref` — the **name** of a server-side env var (validated `UPPER_SNAKE_CASE`), never the secret value (`ai_provider_configs.secret_ref`, with a check that it contains no whitespace). Availability is a boolean derived from `getServerEnv()`/`process.env`; the audit trail records only a `secretRefPresent` boolean. See [`AI_PROVIDERS.md`](./AI_PROVIDERS.md) §3, §6.

## 3. Prompt-injection defence

Retrieved knowledge and customer text are **untrusted data, never instructions**:

- **Detection at ingestion.** `detectInjection()` (`packages/domain/src/prompt-injection.ts`) scans normalized text for instruction-override, system-prompt exfiltration, credential requests, tool/SQL requests, role manipulation, and URL exfiltration. On a hit the document version is `injection_flagged` with safe `injection_categories` — **the malicious text itself is never logged**, only the category — and approval is blocked until resolved ([`KNOWLEDGE_SYSTEM.md`](./KNOWLEDGE_SYSTEM.md) §5).
- **Wrapping at answer time.** Retrieved content is wrapped by `wrapUntrustedContext()` in a fixed, documented delimiter block (`<<<UNTRUSTED_DATA …>>> … <<<END_UNTRUSTED_DATA>>>`) and kept separate from the system instructions; the system prompt instructs the model to treat the block as reference data and ignore any instructions inside it.
- **Safe logging.** Injection findings are recorded as categories only, in `knowledge_ingestion_errors` and the audit log (`knowledge.ingestion.failed`).

## 4. SSRF prevention on URL ingestion

Ingest-by-URL is guarded by `validateExternalUrl()` (`apps/web/src/lib/ai/url-safety.ts`) before any fetch. It rejects: non-`http(s)` schemes (`file:`, `gopher:`, `data:`, `ftp:`, …), credentials embedded in the URL, empty hosts, loopback hostnames (`localhost`, `*.localhost`, `ip6-localhost`), private/loopback/link-local/CGNAT/multicast IPv4 ranges (including the `169.254.169.254` metadata address), private/loopback/link-local/unique-local IPv6 (including IPv4-mapped addresses), and cloud-metadata hostnames (`metadata`, `metadata.google.internal`). The guard validates the literal URL; the production durable fetch worker must additionally re-validate the resolved IP after DNS and on each redirect to defeat DNS-rebinding. Binary document extraction is a disabled stub in Phase 5A (`binaryUploadDisabled()`); text must be extracted in a sandboxed worker and fed in as text.

## 5. Read-only dynamic-tool allow-list

Dynamic project facts come only from a fixed allow-list of read-only tools (`apps/web/src/lib/ai/tools.ts`): `getProjectOverview`, `getProjectConfigurations`, `getCurrentInventorySummary`, `getAvailableUnits`, `getCurrentPriceRange`, `getCurrentOffers`, `getProjectAmenities`, `getProjectLocationFacts`, `getProjectDocuments`, `getApprovedFaqs`. There is **no path that accepts an arbitrary table name or SQL** — every tool issues a specific, parameterised query under the caller's RLS, `callTool` throws `unknown_tool` for anything else, and no tool mutates data. Internal ids and storage URLs are never exposed (e.g. `getProjectDocuments` returns type + title only); results are shaped into customer-safe data and row counts are capped.

## 6. No hidden chain-of-thought

No hidden reasoning, raw prompt body, or full knowledge content is ever stored. `ai_run_messages` rows with role `system` store only a prompt-version reference (`content` must be null by check constraint); retrieval traces deliberately omit raw query/lead text (`query_text`/`query_language` persisted as null); grounding decisions store numeric evidence only.

## 7. Audit carries ids and safe summaries only

Every AI and knowledge mutation writes an audit action (`knowledge.*`, `ai.*` in the catalog — see [`PERMISSIONS_MATRIX.md`](./PERMISSIONS_MATRIX.md) and `packages/validation/src/audit.ts`) carrying reference ids, counts, categories, and customer-safe summaries — **never** prompt bodies, raw lead text, full knowledge content, model answers, or credentials. `ai.usage.limit_reached` is flagged as a security/abuse action.

## 8. RLS tenant and project isolation

Every Phase 5A table has row-level security keyed on `tenant_id`, with select/insert/update policies gated on `current_tenant_id()`, active membership, and the relevant permission. Retrieval, tools, and the orchestrator run under the caller's RLS client and additionally scope by project (the conversation's project or tenant-global), so no query can read another tenant's or an unrelated project's knowledge. Isolation is also asserted directly by the evaluation dataset (cross-tenant/cross-project cases) and the RLS harness ([`TEST_PLAN.md`](./TEST_PLAN.md)).
