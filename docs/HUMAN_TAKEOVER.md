# Human Takeover & the AI Execution Boundary

How a human takes control of a conversation and why an automated responder can
never speak without passing a single, central guard. Authoritative code:
`packages/domain/src/ai-guard.ts`, `apps/web/src/app/(app)/inbox/{actions,ops-actions}.ts`.

## Operating mode

Every conversation has an `operating_mode` of `human`, `paused`, or `ai`.

- **human** — a person owns the conversation; AI must not speak.
- **paused** — no one is actively driving; AI must not speak.
- **ai** — eligible for an automated reply (Phase 5+). **Unreachable from the UI
  today** — the validation enum the UI uses is `['human','paused']`, and
  `resumeTargetMode` can only return `human`/`paused`.

`ai_active` (from Phase 4) is kept `false` everywhere; mode is authoritative.

## The single guard

`canExecuteAutomatedReply(context)` is the only place that may authorise an
automated reply. It returns a populated `AutomatedReplyDecision` (tenant,
conversation, operating mode, takeover, consent, DNC, feature, knowledge, model
statuses) and an `allowed` flag.

`allowed` is true only when **all** of these hold AND a production responder is
installed:

1. `AI_RESPONDER_INSTALLED` (compile-time constant — currently `false`)
2. no human takeover
3. lifecycle is `open`
4. operating mode is `ai`
5. tenant AI feature enabled
6. project AI approved
7. not blocked by do-not-contact
8. consent not withdrawn
9. an approved model configuration exists
10. approved knowledge exists (for project-specific answering)

Because `AI_RESPONDER_INSTALLED` is `false`, the guard **always denies**
(`no_responder_installed`) before Phase 5 — a database flag alone can never
activate AI. A failed gate produces **no customer-visible message**.

## Takeover lifecycle

- **Take over** (`conversations.takeover`) → `operating_mode='human'`, records
  `human_takeover_by/at`, assigns the agent, logs a `takeover` event.
- **End takeover** (`conversations.ai.resume`) → `operating_mode='paused'`
  (never `ai`), clears takeover, logs a `resume` event. The button is labelled
  "End takeover (pause)" — it does **not** start AI.

All transitions are audited. The Phase-5 responder must consult the guard on
every candidate reply; there are no other AI checks to keep in sync.
