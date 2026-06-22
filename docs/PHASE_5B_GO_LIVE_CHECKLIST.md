# Phase 5B — Live-Send Readiness Checklist

**Status:** Not started — this document describes what must be true _before_ the
automatic responder is allowed to send a message to a real customer. Nothing in
this checklist has been actioned. Flipping the responder to live is a deliberate,
reviewed, credentialed, irreversible production step and must not be performed
autonomously (see [`CLAUDE.md`](../CLAUDE.md) §9 and
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4).

**Date:** 2026-06-20

---

## 0. What "go live" actually means

Today the responder is fully built but **cannot send**, by construction:

- `RESPONDER_LIVE_SENDING` is a compile-time `false` in
  [`packages/domain/src/ai-responder.ts`](../packages/domain/src/ai-responder.ts).
  While it is `false`, `decideResponderOutcome` can only ever return
  `blocked | escalate | suppressed` — the otherwise-deliverable path is downgraded
  to `suppressed` with reason `phase_5b_automatic_responder_not_enabled`, and
  `delivered` is the literal `false`.
- The central execution boundary `evaluateAiExecution`
  ([`ai-guard.ts`](../packages/domain/src/ai-guard.ts)) returns
  `maySendAutomatically: false` and denies automatic mode with the same reason.
- The database refuses to record a delivered decision: `ai_responder_decisions`
  has `CHECK (outcome in ('escalate','suppressed','blocked'))`
  ([`0019_ai_responder.sql`](../supabase/migrations/0019_ai_responder.sql)) — the
  `deliver` outcome is not even storable.
- `ai_runs` has `CHECK (mode <> 'automatic')`.

"Going live" means **all** of the following are removed/changed together:
`RESPONDER_LIVE_SENDING → true`, the `evaluateAiExecution` automatic denial is
lifted under explicit conditions, the `ai_responder_decisions` / `ai_runs` CHECKs
are widened to permit a delivered/automatic path, and a real delivery transport is
wired. Doing any one of these in isolation must remain a no-op — they are designed
to fail safe.

---

## 1. Hard prerequisites (the documented stop-line)

None of these can be satisfied by Claude autonomously. Each requires the operator
to provide something external or approve an irreversible action.

- [ ] **Real AI provider credentials, server-side only.** A production chat +
      embedding provider key is configured as an environment secret referenced by
      `ai_provider_configs.secret_ref` — **never** pasted into the conversation,
      committed to the repo, written to logs/audit/prompts, or stored in the
      database in plaintext. The browser only ever sees the Supabase anon key.
- [ ] **Paid-service approval.** Explicit sign-off to incur provider usage cost
      (chat + embeddings at production volume), with the per-tenant usage limits in
      `ai_usage_limits` reviewed and set.
- [ ] **Live Supabase project.** A real project (not the embedded-Postgres test
      harness) with `pgvector` installed, all migrations `0001–0019` applied, and
      the official `supabase db reset` + `supabase test db` (pgTAP) passing.
- [ ] **pgvector ANN path active.** On the live project, the `embedding`
      `vector` column + `<=>` operator variant of `match_knowledge_chunks` is in
      use with an HNSW/IVFFlat index for a fixed model/dimension (the documented
      deferral in [`PHASE_5A_AUDIT.md`](./PHASE_5A_AUDIT.md) §2 /
      [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md)).
- [ ] **Legal / compliance sign-off** for sending automated messages on each
      channel (consent basis, WhatsApp template/session rules, do-not-contact and
      opt-out handling, regional requirements).

---

## 2. Per-message send gates (already enforced in code)

These are implemented today and recorded on every `ai_responder_decisions` row;
going live does **not** relax any of them. Confirm each is still enforced after the
flag flip (the eval harness in `ai-responder-eval.test.ts` asserts the matrix):

- [ ] Conversation `operating_mode = 'ai'` (not `human`/`paused`).
- [ ] No active human takeover (`human_takeover_at` is null).
- [ ] Conversation lifecycle is `open`.
- [ ] No do-not-contact entry for the lead; consent not withdrawn.
- [ ] Platform + tenant + project AI all enabled/approved.
- [ ] Channel policy allows automated sending on this channel.
- [ ] Provider available; per-tenant daily usage limit not reached.
- [ ] Embedding model configured; only **approved + in-effect** knowledge used.
- [ ] Answer is `grounded` with complete citation coverage; otherwise **escalate,
      never guess**.

---

## 3. Code/schema changes required to flip (reviewed PR, not autonomous)

- [ ] Replace the compile-time `RESPONDER_LIVE_SENDING = false` with a
      **per-tenant, per-channel, runtime** enablement that defaults to off and is
      auditable (a config row + permission, not a code constant), so live sending is
      enabled deliberately for one tenant/channel at a time.
- [ ] Lift the `evaluateAiExecution` automatic denial **only** when the runtime
      enablement above is on AND all §2 gates pass; keep the literal-false default.
- [ ] Widen the `ai_responder_decisions` CHECK (and add a delivered/automatic path
      to `ai_runs`) via a new forward-only migration — never rewrite `0019`.
- [ ] Wire a real outbound delivery transport (idempotent, with retry/backoff/DLQ
      via PGMQ — never inline in a browser request) that performs the actual send
      **after** a `deliver` decision, and records the resulting
      `conversation_messages` row + delivery event.
- [ ] Idempotency: a single inbound must produce at most one automatic send, even
      under ret/concurrent processing.

---

## 4. Rollout, observability & kill-switch

- [ ] **Shadow soak first:** run the responder in its current record-only mode on
      live traffic and review the `suppressed` candidates on `/ai/responder` for an
      agreed period; sign off on quality before any real send.
- [ ] **Staged rollout:** enable live sending for one low-risk tenant/channel,
      then expand. One code path for both deployment modes — differences are
      config/flags only.
- [ ] **Kill-switch:** a single operator action that returns the
      tenant/channel to record-only (no send) immediately, plus the existing
      human-takeover and operating-mode controls.
- [ ] **Observability:** alerting on send volume, escalation rate, grounding
      failures, provider errors, and usage-limit breaches; every send audited.

---

## 5. Verification gates (must all pass on the live project)

- [ ] `pnpm format:check` · `pnpm lint` (0 errors) · `pnpm typecheck`
- [ ] `pnpm test` (unit) including the responder eval harness
- [ ] `supabase db reset` + `supabase test db` (pgTAP) green on the live project
- [ ] RLS + idempotency + delivery tests for the new send path
- [ ] Secret scan: no provider key / service-role key in client code, logs, audit,
      prompts, or plaintext DB
- [ ] `pnpm build` (production)

---

## 6. Sign-off

Live sending may be enabled only after every box above is checked and the
following have explicitly approved, in writing:

- [ ] Product owner (paid-service cost + customer-facing behaviour)
- [ ] Engineering (code/schema review of the flip PR)
- [ ] Legal / compliance (consent, channel rules, regional requirements)

Until then the responder remains **record-only** and `RESPONDER_LIVE_SENDING`
stays `false`.
