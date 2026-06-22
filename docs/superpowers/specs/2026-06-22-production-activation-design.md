# Production Activation Design

**Date:** 2026-06-22
**Status:** Approved design for first implementation slice, pending implementation plan
**Scope:** Repo-first production hardening for a full live-activation roadmap
**Primary first-live channel:** Website chat
**Long-term target state:** Live providers and automatic AI customer sending across channels
**Initial safety posture:** Strict sales-safe boundary with staged rollout

## 1. Objective

Prepare the platform for a real production launch path that eventually supports:

- separate staging and production environments
- live website chat as the first real production channel
- broad AI-assisted customer communication
- automatic AI sending only after production evidence proves it safe
- future channel expansion to WhatsApp and email on the same orchestration model

This design does **not** treat broad auto-send as a day-one switch. It treats it as the end-state of a staged activation ladder.

## 2. Non-goals

This design does not assume:

- immediate activation of all live providers in one release
- day-one broad auto-send on every channel
- production and staging sharing infrastructure, credentials, or data
- a browser-only architecture for send decisions or provider secrets

This design also does not authorize unsafe shortcuts such as running demo seed data in production or enabling live sending without audited guardrails.

## 3. Target Operating Model

The system should operate in three clearly separated environments:

| Environment | Purpose                              | Data                    | Supabase                     | Vercel                        |
| ----------- | ------------------------------------ | ----------------------- | ---------------------------- | ----------------------------- |
| Local       | developer iteration                  | synthetic only          | local or isolated dev        | local                         |
| Staging     | hosted verification, QA, smoke tests | synthetic/demo only     | dedicated staging project    | preview or staging deployment |
| Production  | live customer operations             | real customer data only | dedicated production project | production deployment         |

Each environment must use distinct:

- Supabase URL
- anon key
- service-role key
- session-signing secret
- AI provider secrets
- OAuth credentials
- webhook secrets
- monitoring environment identifiers

Production must never share a Supabase project with staging.

## 4. Architecture

The production activation architecture should be split into two layers.

### 4.1 Production safety platform

This shared layer applies to every live channel:

- environment identity and env validation
- live-send feature gates
- policy engine
- audit logging
- observability and alerting
- rollback and kill-switch controls
- delivery retry and failure handling

### 4.2 Channel execution layer

Each channel plugs into the same policy and send-decision platform:

- website chat first
- WhatsApp later
- email later

Website chat is the first production implementation slice because it offers the tightest operational loop, the least external-provider complexity, and the easiest path for rapid human fallback.

### 4.3 First-slice provider runtime

The first implementation slice should activate real providers through a shared
server-only runtime layer instead of wiring feature-specific adapters.

That runtime layer is responsible for:

- resolving the active tenant/provider/model configuration
- loading credentials by `secret_ref` from server env only
- routing `Anthropic` for chat generation
- routing `OpenAI` for embeddings
- normalizing provider usage, latency, finish reason, and error categories
- preserving deterministic mock fallback for local safety and tests

Both `copilot` and `website-chat draft` flows should call the same runtime so
prompt packaging, retrieval context rules, retry behavior, and audit metadata do
not drift by surface.

## 5. Core Runtime Flow

Every outbound AI send decision should follow the same sequence:

1. inbound customer message arrives
2. tenant-scoped knowledge and runtime facts are retrieved
3. the model generates a proposed response and structured safety metadata
4. the policy engine evaluates whether the response may be auto-sent
5. if allowed, the message is queued through the channel executor
6. if not allowed, the response becomes a human-review draft or escalation task
7. the system records audit events and operational metrics regardless of outcome

The model may propose a reply, but the policy layer decides whether it may send.

## 6. Production Components

The following units should remain explicit and separately testable.

### 6.1 Policy engine

Responsible for returning one of:

- `allow_send`
- `require_human_review`
- `block_send`

It should evaluate business rules, safety rules, consent state, environment posture, channel posture, and grounding quality. It must not rely on raw model confidence alone.

### 6.2 Grounding and retrieval evaluator

Responsible for scoring:

- approval state of knowledge
- freshness of inventory and pricing facts
- conflict detection
- citation coverage
- cross-project leakage risk
- cross-tenant leakage risk

### 6.3 Channel orchestrator

Responsible for:

- channel-normalized message lifecycle
- drafting, approval, send, callback, retry, failure, and replay paths
- shared interface across website chat, WhatsApp, and email

### 6.4 Delivery executor

Responsible for:

- queued send execution
- idempotency
- retry policy
- dead-letter handling
- provider callback reconciliation

### 6.5 Audit and observability layer

Responsible for:

- decision logs for every AI proposal
- send/no-send reasoning
- escalation and override events
- model/provider latency and failure telemetry
- operator-visible metrics and alerts

### 6.6 Kill-switch layer

Responsible for stop controls at:

- global deployment level
- environment level
- tenant level
- channel level
- feature mode level
- provider/model level

## 7. Rollout Strategy

Production activation should follow a staged ladder.

### Phase 1. Foundation

- separate staging and production environments
- hardened env validation
- release candidate gates
- forward-only migration flow
- backup and restore drill
- hosted RLS verification
- desktop and mobile smoke tests
- production monitoring and alerting wiring

### Phase 2. Live website chat without auto-send

- website chat operates with real production traffic
- AI runs in shadow and draft modes
- human agents remain the send authority
- telemetry is collected on grounding, confidence, edit rate, latency, and escalation patterns

### Phase 2A. Real-provider draft activation

- `Anthropic` is enabled for internal answer generation
- `OpenAI` embeddings are enabled for ingestion and retrieval
- `copilot` drafts are available to agents
- website chat generates internal drafts from live inbound traffic
- customer delivery remains blocked regardless of provider state
- production activation is gated per environment and per tenant

### Phase 3. Strict-boundary website chat auto-send

- auto-send only for grounded, low-risk, pre-sales informational replies
- anything risky or ambiguous escalates
- website chat remains the only live auto-send surface

### Phase 4. Broader confidence-based website chat auto-send

- expand the allowed set only after production evidence shows acceptable risk
- use explicit widening criteria, not ad hoc operator judgment

### Phase 5. Additional channels

- add WhatsApp
- add email
- preserve the same decision model, audit surface, and kill-switch architecture
- enforce each channel’s provider, compliance, and consent constraints independently

## 8. Safety Boundary For Website Chat

The first live auto-send slice must use a strict sales-safe boundary.

### 8.1 Auto-send allowed only when all conditions pass

- response is grounded in approved tenant knowledge or safe runtime facts
- no stale or conflicting inventory evidence is involved
- no stale or conflicting pricing evidence is involved
- no consent or DNC restriction is active
- no legal, complaint, negotiation, or escalation trigger is detected
- channel, tenant, and business-hour policies allow sending
- model confidence passes threshold
- retrieval quality passes threshold
- citation coverage passes threshold
- no cross-project leakage risk is detected
- no cross-tenant leakage risk is detected

### 8.2 Auto-send must be blocked or escalated for

- price negotiation or discount requests
- refund or compensation requests
- legal, compliance, or guarantee-style claims
- investment return promises
- uncertain availability
- missing knowledge
- conflicting knowledge
- unapproved project content
- stale inventory or stale pricing
- complaints, harassment, or emotionally escalated conversations
- consent or DNC edge cases
- prompt injection or jailbreak attempts
- attempts to reveal internal/system instructions
- cross-project or cross-tenant retrieval anomalies

This policy should be explicit in code and auditable in logs.

## 9. First Implementation Slice: Live Providers + Draft Flows

The first approved implementation slice is narrower than first-live auto-send.
It should make the AI runtime real and production-ready while preserving the
current no-send safety boundary.

This slice should deliver:

- real `Anthropic` generation for internal drafts
- real `OpenAI` embeddings for knowledge ingestion and retrieval
- agent-facing `copilot` drafts in the app
- website-chat internal drafts for live inbound traffic
- grounding, citation, escalation, usage, latency, and provider-status capture
- explicit environment and tenant activation controls
- obvious human fallback in the inbox

This slice must not deliver:

- automatic customer sending
- provider secrets in the browser, prompts, logs, or audit payloads
- draft generation that bypasses grounding or tenant AI policy
- production dependence on unapproved knowledge

The follow-on slice may enable strict-boundary website-chat auto-send, but only
after production evidence from draft mode is acceptable.

## 10. Environment And Infrastructure Requirements

Repo-first hardening should enforce:

- production env validation for required secrets and URLs
- environment identity checks to reduce staging/production confusion
- explicit live-send gates per environment, tenant, and channel
- forward-only migration preflight checks
- documented rollback procedure

Hosted infrastructure should assume:

- separate Vercel staging and production targets
- separate Supabase staging and production projects
- durable async execution for sends and retries
- structured logs
- Sentry
- uptime checks
- alert routing
- secret rotation process

## 11. Testing And Launch Gates

The release path should require:

- format, lint, typecheck, unit, web, PG, build, secret scan, and no-external-IO gates where applicable
- hosted staging migration verification on the exact release candidate
- hosted RLS verification across all roles and cross-tenant cases
- browser smoke tests on desktop and mobile
- red-team prompts for prompt injection, stale inventory, unsupported claims, and cross-tenant retrieval
- incident drills for kill switch, provider outage, bad-output spike, and rollback

For the first real-provider draft slice, launch gates should additionally prove:

- provider adapters return normalized domain-safe results
- missing, invalid, or wrong-provider secrets fail closed
- approved knowledge can produce grounded drafts with citations
- weak grounding, provider timeout, auth failure, and rate limit cases become safe draft suppression or escalation outcomes
- website inbound traffic can create internal drafts without creating any customer delivery event

The widening gate from strict auto-send to broader confidence-based auto-send should require:

- low policy miss rate
- low human correction rate
- no cross-tenant leakage
- no unauthorized sends
- acceptable latency
- acceptable customer resolution quality
- zero launch-blocking incidents over the observation window

## 12. Repo-First Deliverables

Repo-first hardening should produce:

- strengthened production env validation
- updated environment matrix and deployment docs
- production preflight and release scripts
- explicit policy interfaces for AI send decisions
- audit coverage for draft, allow, escalate, block, send, retry, and override events
- channel orchestration boundaries for website chat first
- rollout flags for shadow, draft-only, strict auto-send, and expanded auto-send
- cutover and incident runbooks

For the first implementation slice, repo deliverables should also include:

- server-only `Anthropic` chat adapter
- server-only `OpenAI` embedding adapter
- provider-runtime resolution for active tenant model selection
- mock-preserving fallback behavior for tests and local safety
- settings and audit visibility for provider health and active model state
- environment-gated activation wiring for local, staging, and production drafts

## 13. Risks

The highest-risk area is automatic customer sending. The project should become production-ready for that future state now, but broad auto-send should be treated as an earned rollout state instead of a boolean release switch.

Key risks:

- staging and production environment confusion
- incomplete hosted RLS verification
- weak grounding or stale runtime facts
- inadequate observability during early rollout
- provider failures without durable retry and replay handling
- over-reliance on model confidence without hard policy checks

## 14. Implementation Principles

- production and staging must remain isolated
- policy must remain separate from generation
- every send decision must be auditable
- website chat is the first live channel
- broad auto-send is the target state, not the first launch state
- rollout expansion must depend on measured evidence

## 15. Success Criteria

This design is successful when:

- the repo can produce a clean, repeatable release candidate
- staging and production are clearly separated
- website chat can go live safely before other channels
- the AI runtime supports real-provider shadow and draft-only modes before any auto-send rollout
- `Anthropic` powers internal draft generation and `OpenAI` powers retrieval embeddings through the shared runtime
- agents can use `copilot` and website-chat drafts on live traffic without any customer auto-send
- broad auto-send expansion has explicit acceptance gates
- future WhatsApp and email activation can reuse the same orchestration model without redesigning the core send-decision path
