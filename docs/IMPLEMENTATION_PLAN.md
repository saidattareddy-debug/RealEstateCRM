# Implementation Plan & Milestones

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §34. Phase-by-phase plan with deliverables, exit criteria, and stop-conditions. Every phase ends with: format → lint → typecheck → relevant tests → production build, all green, then [`BUILD_STATUS.md`](./BUILD_STATUS.md) updated and migrations/env changes documented.

---

## 1. Phase exit checklist (applies to every phase)

1. Format (Prettier) clean.
2. ESLint clean.
3. TypeScript strict typecheck clean.
4. Relevant unit/component/db/integration/E2E suites green ([`TEST_PLAN.md`](./TEST_PLAN.md)).
5. Production build succeeds.
6. New tenant tables have RLS + RLS tests; new external surfaces have integration + security tests.
7. `BUILD_STATUS.md`, migrations log, and `.env.example` updated.

## 2. Phases

### Phase 0 — Architecture & documentation ✅ (this deliverable)

Produce the full documentation set, Mermaid architecture + ERD, permissions matrix, page map, API map, milestones, risks, assumptions; resolve contradictions. **Exit:** docs internally consistent; no unresolved contradiction blocking Phase 1.

### Phase 1 — Foundation

**Deliver:** pnpm workspace + repo structure; Next.js App Router app; design system (`packages/ui` tokens/components); Supabase local; env validation (`packages/config`); Auth + MFA scaffold; tenant model + branding; roles/permissions + RLS; app shell (nav, tenant/project switcher, command palette); seed data.
**Exit:** a tenant can be created and branded; RLS-tested isolation; users invited with permissions; app shell renders with real auth. Pin all library versions in the lockfile here.

### Phase 2 — Projects & inventory

**Deliver:** project editor + all attributes; inventory table + statuses + freshness; bulk editor; CSV/XLSX importer + mapping wizard; price/status history; stale-data report; approval workflow; change audit.
**Exit:** projects created; inventory imported and updated; history + audit working; matching reads only real availability.

### Phase 3 — Lead CRM

**Deliver:** ingestion endpoints (form/webhook/CSV) + durable jobs; lead list (filters/saved views/bulk/export); lead detail; dedupe + review queue + reversible merge; broker-overlap flagging; pipeline (Kanban/table/funnel); notes/tasks; assignment engine (auto + manual).
**Exit:** leads arrive from ≥1 webhook + form + CSV; safe dedupe/merge; assignment works; pipeline moves audited.

### Phase 4 — Conversations

**Deliver:** message/conversation model; shared + agent inbox (Realtime); website chat widget; human takeover (pauses AI); conversation summaries; consent/DNC model.
**Exit:** inbound/outbound messages flow; takeover works; summaries generated; DNC enforced.

### Phase 5 — Knowledge & AI

**Deliver:** document ingestion + lifecycle + approval; RAG (pgvector + FTS hybrid); provider abstraction + model registry + routing + usage tracking; grounded AI responses; language detection/handling; escalation; AI auditing (sources/version/confidence); prompt-injection defenses; AI-answer tester.
**Exit:** AI answers from Approved data; unsupported questions escalate; qualification extracted; provenance recorded; injection tests pass.

### Phase 6 — Scoring & matching

**Deliver:** qualification extraction wiring; deterministic scoring engine + explainability + history; no-code rule builder (draft/test/simulate/publish/rollback); project-matching engine.
**Exit:** scores deterministic + explainable; categories work; temporary-Hot + dormant rules correct; matching never returns unavailable units; rule simulation reproducible.

### Phase 7 — WhatsApp & external sources

**Deliver:** Meta WhatsApp Cloud adapter (+ Gupshup/Twilio adapters); WhatsApp onboarding + health; Gmail ingestion/parsers; Google/Meta ad-lead ingestion; portal adapters/fallbacks; generic webhooks; imports hardened.
**Exit:** WhatsApp inbound/outbound (against sandbox/fixtures); Gmail parsing; idempotent ingestion; health checks. **Stop-condition:** live credentials.

### Phase 8 — Automations & visits

**Deliver:** workflow/automation engine + visual editor; score-aware follow-up sequences with all stop conditions + "why sent"; Google Calendar sync (double-booking prevention); site-visit module (full lifecycle); notifications.
**Exit:** follow-ups run reliably and stop correctly; visits scheduled + synced; notifications delivered.

### Phase 9 — Analytics & administration

**Deliver:** dashboards + reports on real data; usage/billing/limits; team performance; integration health; admin system-health page; exports (logged).
**Exit:** dashboard metrics reflect real data; usage/cost tracked; exports logged.

### Phase 10 — Hardening

**Deliver:** security review; full RLS test sweep; accessibility pass; performance + load testing; backup/restore drill; monitoring; deployment runbook completion; docs sync.
**Exit:** [`MASTER_SPEC.md` §35] Definition of Done fully met; security tests pass; no placeholder pages; deployment instructions complete.

## 3. Sequencing rationale

Foundation (security/tenancy/RLS) precedes any tenant data. Projects/inventory precede AI so the knowledge/matching engines have real facts to ground on. Conversations precede AI so there is a channel to answer on. Scoring/matching follow AI extraction. WhatsApp/automations/visits build on conversations + scoring. Analytics aggregates real data last. Hardening closes out. This ordering front-loads the top risks (R1–R4, R6 in [`RISKS.md`](./RISKS.md)).

## 4. Build stop-conditions (pause for product owner)

The build proceeds autonomously through phases **except** when it requires:

- **External credentials** — Meta WhatsApp Business account, Gmail/Calendar OAuth client, AI provider API keys, property-portal access.
- **Irreversible production action** — production data migration, custom-domain cutover, deleting/merging live data at scale.
- **Paid-service commitment** — provisioning paid Supabase/Vercel/provider tiers, purchasing a domain, enabling paid AI/WhatsApp usage.
- **Legally sensitive decision** — data-retention periods, data-processing terms, commission/attribution rules, consent wording.

At a stop-condition the build completes everything possible up to it (with fixtures/sandboxes), documents the blocker in `BUILD_STATUS.md`, and requests the specific input.

## 5. Progress reporting (every phase)

Report: what was completed · files created/changed · migrations added · tests run · test results · remaining work · risks/blockers (§37). Tracked in [`BUILD_STATUS.md`](./BUILD_STATUS.md).
