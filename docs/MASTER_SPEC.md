# MASTER BUILD SPECIFICATION

**White-Label AI Real-Estate Lead Qualification, Scoring and Sales Automation Platform**

> This document is the authoritative product specification. It is reproduced verbatim from the product owner's brief and committed to source control. All other documents in `/docs` derive from and must stay consistent with this file. Where this spec is internally contradictory or under-specified, see [`CONTRADICTIONS.md`](./CONTRADICTIONS.md) and [`ASSUMPTIONS.md`](./ASSUMPTIONS.md) for the resolutions adopted by the build.

You are the principal product architect, UI/UX designer, database architect, AI engineer, security engineer and senior full-stack developer responsible for building this product.

Build a completely fresh, production-ready application. Do not extend the previous static HTML prototype except for using it as a basic indication of the original concept.

The final application must be a working product, not a UI demonstration.

Do not leave core features as placeholders, static cards, hardcoded arrays, fake buttons, non-functional menus or TODO comments.

## 1. PRODUCT MISSION

Build a white-label AI sales and lead-management platform exclusively for real-estate sales.

The product must:

1. Receive leads from paid campaigns, property portals, websites, WhatsApp, files and manual entry.
2. Identify and merge duplicate leads.
3. Communicate naturally with leads through WhatsApp and website chat.
4. Answer questions using approved project information.
5. Gather qualification information naturally through conversation.
6. Calculate an explainable lead score.
7. Categorize leads as Hot, Warm, Cold or Disqualified.
8. Match buyers with suitable projects and available units.
9. Automatically assign leads to sales agents.
10. Alert an assigned representative when human intervention is needed.
11. Follow up until a site visit is scheduled, the lead opts out or the lead is closed.
12. Manage the complete sales pipeline inside the product.
13. Track campaigns, sources, agents, site visits, bookings and lost reasons.
14. Support multiple projects and multiple property categories.
15. Support apartments, villas, plots and commercial properties.
16. Support sale transactions only. Rental enquiries must be classified appropriately and disqualified or redirected according to tenant rules.
17. Work exceptionally well on desktop and mobile.
18. Be white-labelled independently for every client.
19. Support organisations ranging from small brokerages to large developers.
20. Allow the client to choose Claude, OpenAI or Gemini for AI conversations.

This application is the client's CRM. Do not depend on an external CRM.

## 2. PRODUCT ARCHITECTURE

Build a tenant-aware core platform with strict data separation. Each real-estate client is a tenant.

Every tenant must have independent: Branding, Logo, Colours, Custom domain, Projects, Inventory, Users, Roles, Agents, Lead sources, Campaigns, Conversations, Documents, Knowledge base, Scoring rules, Follow-up sequences, Assignment rules, AI provider configuration, Usage limits, Reports, Integrations, Notification settings, Working hours, Quiet hours, Languages, Pipeline stages, Custom fields.

Use one shared application codebase. Support two deployment modes:

**Shared deployment** — One application and Supabase environment with strong tenant isolation through `tenant_id`, PostgreSQL RLS and permission checks.

**Dedicated enterprise deployment** — The same codebase deployed against a dedicated Supabase project, environment and domain for a large client.

Do not create separate code forks per customer.

## 3. REQUIRED TECHNOLOGY STACK

Use current stable and mutually compatible versions. Pin exact versions in the lockfile.

**Application:** Next.js App Router, React, TypeScript strict mode, pnpm, Tailwind CSS, shadcn/ui, Radix UI primitives, Lucide icons, TanStack Table, TanStack Query, React Hook Form, Zod, Recharts, Motion, date-fns, next-intl or equivalent.

**Backend and data:** Supabase PostgreSQL, Supabase Auth, Supabase Storage, Supabase Realtime, Supabase Edge Functions, Supabase Queues or PGMQ, Supabase Cron, pgvector, PostgreSQL full-text search, SQL migrations in source control.

**AI:** Vercel AI SDK or clean provider-adapter abstraction, Anthropic provider, OpenAI provider, Google Gemini provider, structured output validated through Zod, configurable embeddings provider, versioned prompts, model usage and cost tracking, model fallback rules.

**Integrations:** Meta WhatsApp Cloud API, optional Gupshup adapter, optional Twilio adapter, Gmail OAuth, Google Calendar OAuth, Google Ads and Meta lead ingestion, generic webhook ingestion, website lead form endpoint, embeddable website chat widget, CSV and XLSX import, PDF/DOCX/website knowledge ingestion.

**Quality and operations:** Vitest, React Testing Library, Playwright, ESLint, Prettier, GitHub Actions, Sentry, structured application logs, environment validation, database backup documentation, separate local/staging/production environments.

Host the web application on Vercel.

## 4. REPOSITORY STRUCTURE

```text
apps/
  web/
packages/
  ui/
  domain/
  validation/
  ai/
  integrations/
  analytics/
  config/
supabase/
  migrations/
  seed/
  functions/
  tests/
docs/
  MASTER_SPEC.md
  PRD.md
  ARCHITECTURE.md
  DATABASE.md
  SECURITY.md
  AI_SYSTEM.md
  SCORING_ENGINE.md
  INTEGRATIONS.md
  UI_SYSTEM.md
  TEST_PLAN.md
  DEPLOYMENT.md
  BUILD_STATUS.md
CLAUDE.md
README.md
```

Create `CLAUDE.md` with: architecture rules, repository conventions, commands, testing requirements, security restrictions, definition of done, references to `/docs`, instructions to keep documentation synchronized with code.

## 5. ROLES AND PERMISSIONS

Implement permission-based access rather than relying only on role-name checks.

Required default roles: **Platform Super Admin**, **Client Admin**, **Marketing Manager**, **Sales Manager**, **Sales Agent**, **Project Data and Maintenance Team**, **Viewer**. (Full capability lists per role are in the brief and reproduced in `PERMISSIONS_MATRIX.md`.)

Create a permission matrix and test it. The Project Data and Maintenance role must not automatically receive access to private lead conversations. Super admins must not access tenant information silently; impersonation must be secure, audited and time-limited.

## 6. WHITE-LABEL CONFIGURATION

Every tenant must configure: business name, logo, favicon, primary/secondary/accent colours, light and dark themes, login-page image, email sender name, support information, custom domain, dashboard/project/agent terminology, default language, enabled conversation languages, date/currency/number formats, timezone, quiet hours, legal and privacy links.

The application must not expose platform branding when white-label mode is enabled. Use feature flags and plan limits rather than hardcoding functionality by client.

## 7. CORE DATA MODEL

Design normalized PostgreSQL tables with foreign keys, constraints, indexes and RLS. Every tenant-owned table must include `tenant_id`. The full table catalog is in `DATABASE.md`. Required inventory statuses: Available, Temporarily held, Reserved, Booked, Sold, Blocked, Unavailable. Normalize phone numbers to E.164. Store first-touch and last-touch attribution. Store provider payloads in JSONB for auditing but also normalize fields required for querying. Use soft deletion only where recovery is valuable.

## 8. LEAD INGESTION

Support: Google PPC, Meta PPC, Meta lead forms, Google lead forms, personal campaign landing pages, website forms, website chatbot, WhatsApp, NoBroker, 99acres, Housing.com, Magicbricks, other portals, broker submissions, email lead notifications, manual entry, CSV upload, XLSX upload, generic API, generic webhook.

Build a connector architecture. For each source: verify webhook authenticity, store the original event, generate/read an idempotency key, normalize the data, validate contact fields, find potential duplicates, merge or create the lead, preserve every attribution touchpoint, trigger qualification and scoring, trigger assignment, trigger the appropriate first response, create an audit entry.

When a portal has no usable API, support Gmail lead-notification parsing, CSV/XLSX import, manual mapping templates, generic webhook forwarding. Create an import mapping wizard mapping arbitrary columns to product fields.

## 9. DUPLICATE DETECTION

Use: normalized phone, phone without country prefix, email, alternate phone, source lead ID, fuzzy name match combined with another identifier, same campaign and contact within a time window.

Confidence levels: Exact duplicate, Probable duplicate, Possible duplicate, Not a duplicate. Exact duplicates may merge automatically per tenant settings. Possible/probable duplicates go to a review queue.

A merge must preserve all messages, source records, attribution history, notes, score history, assignments, documents; choose a canonical contact value; create a reversible audit record. Do not silently delete duplicate records.

**Broker and direct-lead overlap:** Detect when the same buyer enters directly and through a broker. Flag as a potential attribution/commission conflict. Do not auto-declare ownership. Allow admin resolution with status, notes, source precedence, datetime, responsible user, estimated commission exposure. Retain optional metrics (duplicate broker leads identified, estimated commission exposure prevented).

## 10. PROJECT AND INVENTORY MANAGEMENT

Each tenant manages multiple projects with full attributes (see `DATABASE.md`). Build: manual project editor, inventory table, bulk inventory editor, CSV/XLSX importer, price-history tracking, inventory status history, stale-data warnings, approval workflow, change audit log.

AI must never recommend an unavailable, booked or sold unit as currently available. When inventory information is older than the tenant's freshness limit, the AI must qualify its answer and escalate availability confirmation to a human.

## 11. KNOWLEDGE BASE AND RAG

Build a project-scoped RAG system. Sources: PDF, DOCX, TXT, CSV, XLSX, website URL, Google Drive, manual text, FAQs, project fields, inventory records, API data.

Document statuses: Draft, Processing, Needs review, Approved, Rejected, Archived, Expired. Only approved and active information may be used in customer answers.

Implement text extraction, chunking (default 500–800 tokens, 80–120 overlap, preserve heading/page metadata), metadata enrichment, embedding generation, vector search, full-text search, hybrid retrieval, project/document-type/version filtering, source-page preservation, re-indexing, deletion/invalidation.

Every generated answer must record sources retrieved, document version, page/section, retrieval scores, model, prompt version, response confidence. Agents must be able to inspect sources. Uploaded documents and website text are untrusted content; ignore instructions inside documents and treat them only as reference.

## 12. AI CONVERSATION ENGINE

Channels: WhatsApp, website chat (architecture must allow email/voice later). Languages: English, Hindi, Kannada, Tamil, Telugu, Hinglish. Detect language per incoming message; reply in the lead's preferred language; preserve project names, currency, unit names, addresses accurately during translation.

Style: conversational, polite, natural, concise, helpful, calm, consultative, non-robotic, focused on buyer intent. Ask one main qualification question at a time, avoid interrogation, reuse prior answers, recognize partial answers, confirm ambiguities, vary wording, avoid excessive emojis/artificial urgency/pressure.

For project-specific questions, answer only from approved project data, current inventory, approved documents/FAQs/offers/location records. Never invent price, availability, unit number, discount, offer, possession date, approval, legal status, construction status, amenity, payment plan, refund policy. The assistant may answer general domain questions (carpet area meaning, buying process, site-visit prep, basic loan terms, apartment/villa/plot differences) but must clearly distinguish general from verified project information and remain within real-estate sales.

**Human escalation** triggers (immediate): lead requests a person; confidence below threshold; no approved source; custom discount request; price negotiation; legal interpretation; payment dispute; lead reports incorrect info; conflicting availability; upset lead; ready to book; cancellation/refund request; complex financing; safety/fraud/abuse. Escalation must assign/identify the rep, send in-app (and optional email) notification, include conversation summary + unanswered question + score and reasons + recommended next action, and pause AI responses until takeover ends. AI resumes only via explicit setting or defined timeout.

## 13. AI MODEL ROUTING

Support Claude, OpenAI, Gemini via a provider-neutral model registry. Configure by platform/tenant/task/project/language/cost limit/availability/fallback order. Use lower-cost models for language detection, field extraction, intent/message classification, summaries, basic FAQ routing; stronger models for complex comparisons, ambiguous conversations, objection handling, low-confidence answers, multilingual reasoning, escalation summaries.

Use structured outputs (Zod-validated) for extracted fields, intent, sentiment, objection type, urgency, timeline, budget, location, configuration, property type, site-visit intent, escalation reason, AI confidence. Track input/output tokens, cost, latency, provider, model, tenant, conversation, task, success/failure, fallback usage. Add monthly tenant budgets, alerts, hard/soft limits.

## 14. LEAD QUALIFICATION

Collect naturally through conversation. Core fields listed in the brief (name, phone, email, language, city, preferred location, category, project, configuration, budget min/max, purpose, timeline, urgency, possession preference, funding, loan need/pre-approval, decision-maker status, other decision-makers, other projects considered, competing visits, amenities, family requirements, preferred contact time, preferred site-visit date, source, campaign, UTM, objections). Do not require every field before responding. Maintain a qualification-completeness percentage. AI determines the next best question from missing important info, current score, conversation stage, intent, relevance, prior unanswered questions.

## 15. HYBRID LEAD-SCORING ENGINE

AI extracts signals; deterministic rules calculate the official score. The AI must not directly invent the final score. Internal score 0–100; category displayed prominently.

**Component A — Project & buyer fit (max 40):** budget fits available inventory +20; within 10% of min +14; within 20% +7; exact configuration match +8; property category match +4; preferred location/project match +4; purpose captured +2; amenity match up to +2.

**Component B — Buyer intent (max 30):** explicit site-visit request +20; requests availability +8; requests price sheet/payment plan +6; requests floor plan/brochure +4; detailed comparison questions +4; mentions evaluating competitors +4; requests callback +6; asks booking procedure +10. Cap at 30.

**Component C — Urgency (max 20):** ≤30 days +20; 31–90 +14; 3–6 months +8; 6–12 months +3; >12 months +0; unknown +0.

**Component D — Engagement (max 10):** responds promptly up to +3; ≥3 meaningful exchanges +3; opens/requests material +2; returns to conversation +2; confirms callback/visit +4. Cap at 10.

**Negative signals:** rental-only → hard disqualification; job seeker/vendor/spam → hard disqualification; explicit opt-out → hard stop + do-not-contact; invalid contact → strong penalty + review; budget >20% below all matching inventory with no flexibility −25; no response 24h −3; 72h additional −5; 7d additional −7; repeated unrelated responses −5; timeline >1 year → no urgency points, not auto-disqualification. Do not disqualify merely for non-response; move to dormant/nurture.

**Category thresholds (defaults):** Hot 75–100, Warm 45–74, Cold 0–44, Disqualified by approved hard rule. A confirmed site-visit request may temporarily classify Hot even with missing fields. Operational statuses (New, Qualifying, Needs human review, Nurturing, Dormant) are separate from Hot/Warm/Cold/Disqualified.

Every score shows current numeric score, category, positive/negative factors, missing info, last change, causing event, rule version, AI evidence, confidence, recommended next action. Maintain complete score history.

**Configurable no-code rule builder** with conditions (field value, range, source, campaign, project, category, configuration, budget, timeline, intent, message count, site-visit/document activity, agent action, time since response, custom fields) and actions (add/subtract points, set category, disqualify, require review, assign agent, start/stop automation, notify manager, add tag). Support draft/test/historical simulation/publish/rollback/priority/cap/effective date/audit history.

**Predictive scoring:** begin rule-based; collect outcomes; after sufficient tenant data, add optional conversion probability (never silently replace rule scoring; show rule score + predictive probability + confidence; validate and approve before influencing prioritization; never train across tenants without authorization; never use protected attributes).

## 16. PROJECT-MATCHING ENGINE

Deterministic engine. Hard filters: sale only, property category, available inventory, location restrictions, required configuration, max budget where specified. Rank by budget/configuration/location/possession/category/amenity fit, buyer purpose, inventory availability, stated priorities. Return match percentage, top projects, matching configurations, matching available units, recommendation reason, mismatch warnings, info still needed. AI may explain matches but must not create or alter inventory facts.

## 17. LEAD ASSIGNMENT

Automatic and manual. Rule engine using project, location, language, category, score, source, campaign, agent skill/availability, workload, working hours, round-robin position, max active leads, previous relationship, manager priority. Default process: filter eligible agents → prefer project-authorized → match language → remove unavailable → respect workload → apply score/specialisation rules → weighted round robin → record reason. Managers can manually/bulk assign, lock, rebalance, transfer, configure temporary absence. Never overwrite a manual assignment without an explicit rule.

## 18. FOLLOW-UP AUTOMATION

Respond immediately to new WhatsApp enquiries. Configurable score-aware sequences (immediate, hot, warm, cold variants per brief). Support conditional branches, delays, working-hour/quiet-hour rules, language-specific messages, approved WhatsApp templates, dynamic AI messages, static templates, attachments/videos/maps/site-visit links, agent tasks, score/stage changes, stop conditions. Required stop conditions: site visit booked, human takeover, opt-out, wrong number, do-not-contact, booked, lost, disqualified, complaint, manager stop. No spam-like behaviour. Record why every automated message was sent.

## 19. WHATSAPP INTEGRATION

Meta WhatsApp Cloud API default. `MessagingProvider` interface (sendText, sendTemplate, sendMedia, markRead, processWebhook, normalizeInboundMessage, getDeliveryStatus). Adapters for Meta Cloud API, Gupshup, Twilio. Support inbound text/images/documents/audio metadata/interactive replies/buttons/lists/templates, delivery/read/failure events, contact info, media downloads, template language/category/approval status. Tenant onboarding for business account, phone-number ID, WABA ID, webhook verification, token validation, template sync, test message, integration health. Never expose access tokens to the browser. Respect session restrictions, template requirements, consent, opt-out.

## 20. WEBSITE CHAT

Embeddable widget: small JS embed, tenant identification, project preselection, UTM/page-URL/campaign capture, responsive mobile widget, custom branding, language detection, file/brochure sharing, conversation persistence, handoff to WhatsApp, human takeover, rate limiting, bot-abuse protection. Tenant config: welcome message, avatar, colours, position, working hours, enabled pages, initial questions, project context.

## 21. GMAIL AND CALENDAR

**Gmail** (OAuth, minimum scopes): read lead-notification emails from portals, parse new lead info, send rep alerts where configured, link source email to lead, avoid duplicate processing. Source-specific + generic configurable parser. Validate sender domains and message patterns, not only sender names.

**Google Calendar:** agent calendar connection, availability checking, site-visit booking, rescheduling, cancellation, reminders, project location, assigned agent, lead contact, internal notes, status sync. Prevent double booking. Store event linkage without exposing provider tokens.

## 22. PIPELINE

Default stages: New, Contacted, Qualifying, Qualified, Site Visit Scheduled, Site Visit Completed, Follow-up, Negotiation, Booking in Progress, Booked, Lost, Disqualified. Tenant-customizable. Views: Kanban, Table, Funnel analytics. Stage moves record user, datetime, previous/new stage, optional required reason, trigger automations, recalculate tasks and SLA.

## 23. SITE-VISIT MANAGEMENT

Full module: project, lead, agent, datetime, meeting point, transport requirement, visitor count, decision-makers attending, confirmation status, reminder status, reschedule, cancellation, no-show, completed visit, visit notes, outcome, next action, follow-up task. Calendar/list/project views. Auto-send confirmation, location, agent details, reminder, reschedule info, post-visit follow-up.

## 24. REQUIRED APPLICATION PAGES

Full page list (auth, dashboard, leads, lead details, conversation inbox, pipeline, projects, inventory, site visits, tasks, campaigns/sources, automations, lead scoring, knowledge base, analytics/reports, team, integrations, billing/usage, settings) is enumerated in `PAGE_MAP.md`.

## 25. UI AND DESIGN SYSTEM

Premium real-estate SaaS interface combining Linear's clarity/spacing, Attio's CRM organisation, HubSpot's pipeline usability, restrained premium real-estate identity. Do not copy another product.

**Default light theme tokens:** App background `#F6F4EF`; Surface `#FFFFFF`; Elevated `#FCFBF8`; Primary text `#202522`; Secondary text `#66706A`; Forest green `#274D3D`; Deep forest `#18372B`; Champagne accent `#B79257`; Terracotta alert `#C95D4B`; Success `#2F7D5B`; Warning `#C38A2E`; Border `#E4E1D9`. Provide an optional refined dark theme. No pure black backgrounds.

Typography: clean sans-serif for the operational interface; optional elegant serif only for project titles/marketing; max two font families; readability over decoration. 12–16px surface radius, subtle borders, minimal shadows, restrained animation. Always include loading, error, empty, permission-denied states. Mobile responsiveness mandatory with bottom navigation (Today, Inbox, Leads, Visits, More) and sticky lead actions (Call, WhatsApp, Add note, Update stage, Schedule visit). Installable as a PWA where practical. Do not shrink desktop tables onto mobile — use cards, drawers, sheets.

## 26. SEARCH AND FILTERING

Global search across lead name/phone/email/project/unit/agent/conversation content/notes/source/campaign. Lead filtering across score, category, stage, project, category, configuration, budget, timeline, source, campaign, agent, last activity, created date, site-visit status, qualification completeness, language, lost reason, tags. Saved views and shareable team views.

## 27. ANALYTICS

Filterable by tenant, date, project, source, campaign, agent, category, configuration, lead category. Track the full metric set in the brief. Do not label correlation as causation.

## 28. SECURITY

Supabase Auth; RLS on all exposed tenant tables; server-side permission checks; no service-role key in browser; no provider secret in browser; secure server-side integration secrets; webhook signature verification; idempotency; rate limiting; input validation; output encoding; CSRF protection; secure cookies; session expiration; audit logs; login security events; optional MFA; PII masking by permission; export logging; data-deletion workflows; retention policies; dependency scanning; secret scanning; security headers; safe file-upload validation; malware-scanning integration point; prompt-injection defences; AI-output validation; do-not-contact enforcement. Every RLS policy must have automated tests. Super admins must not gain silent unrestricted access via client-side code. Impersonation must be time-limited, visible, audited. Use synthetic seed data.

## 29. RELIABILITY AND BACKGROUND PROCESSING

Durable background processing for lead ingestion, WhatsApp sending, AI processing, document extraction, embedding generation, follow-ups, notifications, imports, Gmail/Calendar sync, analytics aggregation. Implement retry policy, exponential backoff, max attempts, dead-letter handling, idempotency, job visibility, manual replay, error reason, correlation ID, tenant ID, source event ID. Do not execute important multi-step workflows only inside a browser request.

## 30. API REQUIREMENTS

Documented APIs for lead creation/update/search, webhook ingestion, conversation messages, project data, inventory, site visits, tasks, scoring, documents, reporting. Include authentication, tenant scoping, validation, pagination, rate limits, idempotency, error format, versioning, request IDs. Generate OpenAPI documentation where practical.

## 31. TESTING

Unit (scoring, thresholds, matching, dedupe, assignment, follow-up branching, permission helpers, validation, AI structured-output parsing), Database (RLS, constraints, tenant isolation, triggers, functions, score/stage history), Integration (WhatsApp webhook, lead-form webhook, Gmail parser, calendar sync, document ingestion, AI fallback, queue retry, import mapping), E2E (tenant onboarding, invitation, project creation, document upload, lead arrival, duplicate merge, AI qualification, score calculation, assignment, human takeover, site-visit booking, pipeline movement, opt-out, reporting), Accessibility (keyboard nav, focus states, labels, contrast, landmarks, dialog behaviour, touch targets). Do not mark a phase complete while its tests fail.

## 32. OBSERVABILITY

Structured logs, correlation IDs, Sentry, webhook logs, job logs, AI-call logs, integration-health checks, queue health, failed-message monitoring, alerting hooks, admin system-health page. Redact secrets and unnecessary PII from logs.

## 33. DEPLOYMENT

Local dev instructions, Supabase local setup, staging, production, Vercel config, env-var template, migration process, seed process, custom-domain docs, integration setup docs, rollback procedure, backup/restore procedure, release checklist. GitHub Actions for type checking, linting, unit tests, build, database tests, E2E where feasible, migration validation.

## 34. PHASED IMPLEMENTATION PLAN

Do not attempt the entire platform in one uncontrolled coding pass. Maintain `docs/BUILD_STATUS.md`. Execute in order:

- **Phase 0 — Architecture & documentation:** PRD, architecture, database model, RLS strategy, AI design, scoring design, UI system, integration strategy, test plan, delivery plan. Resolve contradictions before coding.
- **Phase 1 — Foundation:** repository, Next.js app, design system, Supabase local, auth, tenant model, roles, permissions, RLS, branding, app shell.
- **Phase 2 — Projects & inventory.**
- **Phase 3 — Lead CRM:** ingestion, list, details, dedupe, pipeline, notes, tasks, assignment.
- **Phase 4 — Conversations:** shared inbox, website chat, message model, human takeover, summaries.
- **Phase 5 — Knowledge & AI:** document ingestion, RAG, provider abstraction, AI responses, language handling, escalation, AI auditing.
- **Phase 6 — Scoring & matching.**
- **Phase 7 — WhatsApp & external sources.**
- **Phase 8 — Automations & visits.**
- **Phase 9 — Analytics & administration.**
- **Phase 10 — Hardening.**

At the end of each phase: run formatting, linting, type checking, relevant tests, production build; correct all failures; update `BUILD_STATUS.md`; document migrations and environment changes; continue unless external credentials or an irreversible business decision are required.

## 35. DEFINITION OF DONE

The platform is complete only when all 30 acceptance criteria in the brief are met (tenant creation/branding, RLS-tested isolation, invitations, multiple projects, inventory import/update, document indexing, multi-source lead arrival, safe dedupe, AI answering from approved data, escalation of unsupported questions, natural qualification extraction, deterministic explainable scoring, working categories, automatic and manual assignment, agent takeover, reliable follow-ups, site-visit scheduling/sync, working pipeline, real dashboard metrics, practical mobile workflows, cost tracking, webhook retry, audit logs, passing security tests, no privileged key in browser, no static placeholder pages, complete deployment instructions).

## 36. INITIAL ASSUMPTIONS

Primary market India; timezone Asia/Kolkata; currency INR; sale only; primary channel WhatsApp; secondary website chat; premium light + optional dark themes; thresholds Hot 75+/Warm 45–74/Cold <45; escalation confidence threshold 0.75; inventory freshness 24h; quiet hours 8:00 PM–9:00 AM tenant-local; default pipeline as specified; default language English plus Hindi/Kannada/Tamil/Telugu/Hinglish. All defaults must be configurable.

## 37. WORKING INSTRUCTIONS

Inspect the fresh repository, then create the complete documentation set, a Mermaid architecture diagram, a Mermaid ERD, a permissions matrix, a page map, an API map, implementation milestones, technical risks, recorded assumptions, then implement phase by phase. Do not re-ask questions already answered here. Make reasonable, documented decisions. Ask only when blocked by missing external credentials, a destructive production action, a legally sensitive decision, a paid service commitment, or an irreversible architecture decision not covered here. Do not claim completion without running the relevant commands and tests. When reporting progress, always include what was completed, files created/changed, migrations added, tests run, test results, remaining work, risks/blockers.

Build this as a commercial product that an agency can confidently sell to real-estate developers and brokerages.
