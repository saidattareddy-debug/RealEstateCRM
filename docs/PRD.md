# Product Requirements Document (PRD)

**Product:** White-Label AI Real-Estate Lead Qualification, Scoring & Sales Automation Platform
**Status:** Phase 0 — authoritative for product scope. Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md).
**Owner:** Principal product architect (this build).

---

## 1. Problem statement

Real-estate developers and brokerages buy expensive leads from paid campaigns and property portals, then lose most of them to slow first response, inconsistent qualification, duplicate records, and unstructured follow-up. Sales teams cannot tell which leads deserve attention, and managers have no reliable view of source ROI, agent performance, or pipeline health. Existing generic CRMs do not understand real-estate inventory, do not converse with buyers, and require manual data entry that never happens.

## 2. Product vision

A single, white-labelled CRM that ingests every lead, talks to buyers naturally on WhatsApp and website chat in their own language, answers only from approved project data, qualifies and scores leads with an explainable engine, matches buyers to available units, assigns the right agent, follows up relentlessly until a site visit is booked or the lead opts out, and gives managers a complete, real-data operational picture — sellable by an agency to many clients from one codebase.

## 3. Goals and non-goals

### Goals

- Be the client's system of record for leads, conversations, projects, inventory, visits and bookings.
- Sub-minute first response to inbound WhatsApp enquiries via automation.
- Deterministic, auditable lead scoring that a sales manager can trust and tune without code.
- Never state an unverified project fact (price, availability, offer, legal status) to a buyer.
- True multi-tenant isolation: one breach must not cross tenants.
- Excellent on a sales agent's phone, not just on a desktop.

### Non-goals (v1)

- Rental transaction management (rentals are classified and disqualified/redirected per tenant rules).
- Acting as a general-purpose chatbot outside real-estate sales.
- Replacing accounting/ERP or legal documentation systems.
- Voice and email _conversation_ channels (architecture must allow them later; not built in v1).
- Cross-tenant model training (explicitly prohibited without authorization).

## 4. Target users and primary jobs-to-be-done

| Persona                                      | Context                                          | Primary jobs                                                                                                   |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Platform Super Admin** (agency)            | Operates the platform across many client tenants | Provision/suspend tenants, set plans/limits, monitor platform health, configure default models, manage domains |
| **Client Admin** (developer/brokerage owner) | Runs one tenant                                  | Configure branding, integrations, roles, scoring, automations; oversee all leads/projects                      |
| **Marketing Manager**                        | Owns demand                                      | Manage campaigns/sources, upload leads, view attribution and cost metrics, manage scoring (with approval)      |
| **Sales Manager**                            | Owns conversion                                  | Configure pipeline/assignment, manage agents, reassign, review conversations, approve classifications          |
| **Sales Agent**                              | On the floor / on the phone                      | Work assigned leads, take over AI chats, schedule and record site visits, update stages, log outcomes          |
| **Project Data & Maintenance**               | Keeps facts true                                 | Maintain projects, pricing, inventory, brochures, offers, construction status, approved knowledge              |
| **Viewer**                                   | Senior management                                | Read-only dashboards and reports                                                                               |

## 5. Core capabilities (requirements summary)

1. **Multi-source ingestion** — paid ads, portals (NoBroker, 99acres, Housing, Magicbricks), website forms/chat, WhatsApp, broker submissions, email notifications, manual entry, CSV/XLSX, generic API/webhook; each through a connector with authenticity verification, idempotency, normalization, dedupe, attribution preservation, and triggered qualification/assignment/first-response.
2. **Duplicate detection & safe merge** — multi-signal matching with confidence levels; auto-merge only exact duplicates per tenant settings; review queue otherwise; reversible, audited merges; broker/direct overlap flagged as commission conflict without auto-deciding ownership.
3. **Project & inventory management** — multiple projects and categories (apartment, villa, plot, commercial), unit-level pricing and statuses, price/status history, stale-data warnings, approval workflow, audit log. AI never recommends unavailable units; stale availability is qualified and escalated.
4. **Knowledge base & RAG** — project-scoped ingestion (PDF/DOCX/TXT/CSV/XLSX/URL/Drive/manual/FAQ/fields/inventory), approval lifecycle, hybrid vector + full-text retrieval, source/version/page tracking, prompt-injection-safe handling of untrusted documents. Only approved content reaches buyers.
5. **AI conversation engine** — WhatsApp + website chat, six languages, language detection, consultative one-question-at-a-time style, strict answer boundaries, structured escalation that pauses AI.
6. **AI model routing** — Claude/OpenAI/Gemini via provider-neutral registry; cheap models for classification/extraction, strong models for reasoning; Zod-validated structured outputs; full usage/cost tracking with budgets and fallback.
7. **Lead qualification** — natural extraction of the qualification field set, completeness percentage, AI-chosen next-best question.
8. **Hybrid scoring** — AI extracts signals, deterministic rules compute the 0–100 score across four components plus negative signals; explainable with history; no-code rule builder with draft/test/simulate/publish/rollback; optional later predictive layer that never silently replaces rules and never uses protected attributes.
9. **Project matching** — deterministic hard filters + ranked fit; returns match %, projects, configurations, available units, reasons, mismatch warnings, missing info.
10. **Lead assignment** — rule engine (project/location/language/skill/availability/workload/round-robin) plus manual override that automation never silently overwrites.
11. **Follow-up automation** — immediate first response, score-aware sequences, working/quiet-hour rules, approved templates + dynamic AI messages, comprehensive stop conditions, full "why sent" auditing, no spam.
12. **WhatsApp integration** — Meta Cloud API default with Gupshup/Twilio adapters; templates, media, delivery/read events; tenant onboarding; tokens server-side only.
13. **Website chat widget** — embeddable, branded, UTM-aware, abuse-protected, WhatsApp handoff.
14. **Gmail & Calendar** — lead-notification parsing; agent calendar availability, booking, reminders, double-booking prevention; provider tokens never exposed.
15. **Pipeline** — customizable stages, Kanban/table/funnel views, audited stage moves with SLA recalculation.
16. **Site-visit management** — full lifecycle with confirmations, reminders, outcomes, follow-up tasks.
17. **Analytics** — full operational and ROI metric set, filterable; correlation never labelled causation.
18. **Security, reliability, observability** — RLS everywhere with tests, durable background jobs with DLQ/retry/replay, structured logs, Sentry, admin health page.

## 6. Key product principles (decisions)

- **Truth over fluency.** The assistant would rather escalate than invent a fact. Approved-source grounding and inventory freshness checks are hard constraints, not guidelines.
- **Explainability over black boxes.** The official score is deterministic and rule-versioned. ML is additive and gated.
- **Permissions, not role names.** Authorization is checked against granular permissions so roles can be customized per tenant.
- **Configuration over forks.** All client differences are data (branding, flags, limits, rules) on one codebase and two deployment modes.
- **Mobile is first-class.** Agents live on phones; mobile gets purpose-built layouts, not shrunk tables.
- **Every automated action is accountable.** Messages, merges, assignments and score changes all record who/what/why.

## 7. Success metrics (product-level)

| Metric                                                 | Target intent                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| First-response time to inbound WhatsApp                | Median < 60s (automation)                                        |
| Lead qualification rate                                | Increase vs. tenant baseline; tracked per source                 |
| Duplicate leads detected & safely merged               | High recall, zero silent deletions                               |
| AI containment rate                                    | Conversations resolved/advanced without human, with quality held |
| Escalation precision                                   | Escalations are genuinely human-needed (low false escalation)    |
| Site-visit booking rate                                | Increase per qualified lead                                      |
| Cost per qualified lead / per site visit / per booking | Visible and decreasing where spend data exists                   |
| Cross-tenant data incidents                            | Zero (RLS-enforced, test-gated)                                  |

These are product outcomes; analytics definitions and guardrails ("do not label correlation as causation") are in [`MASTER_SPEC.md` §27].

## 8. Constraints and assumptions

- **Market defaults:** India, Asia/Kolkata, INR, sale-only, WhatsApp-primary — all configurable. See [`ASSUMPTIONS.md`](./ASSUMPTIONS.md).
- **Compliance-sensitive:** WhatsApp messaging-session/template rules, consent and opt-out (do-not-contact) enforcement, PII handling, retention policies.
- **External dependencies** (block later phases, not Phase 0): Meta WhatsApp Business account, Gmail/Calendar OAuth credentials, AI provider keys, portal access. Listed in [`INTEGRATIONS.md`](./INTEGRATIONS.md) and the build stop-conditions in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## 9. Release strategy

Phased delivery (Phases 0–10 per [`MASTER_SPEC.md` §34] and [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)). Each phase ends with format/lint/typecheck/tests/build green and an updated [`BUILD_STATUS.md`](./BUILD_STATUS.md). The build stops for product-owner input only when blocked by external credentials, irreversible production actions, paid-service commitments, or legally sensitive decisions.

## 10. Open questions

Tracked centrally in [`CONTRADICTIONS.md`](./CONTRADICTIONS.md) (spec tensions resolved with a default) and [`ASSUMPTIONS.md`](./ASSUMPTIONS.md). No Phase-0 blockers remain; all are resolved with a documented, reversible default.
