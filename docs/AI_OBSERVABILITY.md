# AI Responder Observability

The metrics, dashboards, and alert queries for the automatic responder. **Production alerting is not active.** No monitoring provider is configured in Phase 5B.0; the items below are documented queries and interfaces against the data the system already records (the `ai_responder_decisions`, `ai_send_candidates`, `ai_send_attempts`, and escalation/audit rows). They describe what _would_ be watched once a monitoring backend is wired in 5B.1 — they are not live alerts today, and because the responder is record-only, the most important metric (real sends) is structurally zero.

See [`PHASE_5B_READINESS.md`](./PHASE_5B_READINESS.md) for the overall state and [`DEPLOYMENT.md`](./DEPLOYMENT.md) §11 for the broader production observability baseline.

---

## 1. Metrics / dashboards

The following are the responder-specific signals to surface on a dashboard:

- **Candidate count** — total `ai_send_candidates` generated, by tenant/channel/project.
- **Simulated sends** — count of candidates that reached `simulated` (in 5B.0 every "send" is simulated; a real-send dashboard would track delivered, which stays 0).
- **Suppression reasons** — distribution over the `shouldCancelStaleCandidate` reasons (candidate_expired, kill_switch_active, human_takeover, conversation_closed, human_replied, newer_customer_message, dnc_activated, consent_changed, knowledge_withdrawn, inventory_stale).
- **Escalation reasons** — distribution over the escalation categories from the decision/escalation rows.
- **Grounding / citation failures** — `not_grounded` and `citation_incomplete` counts.
- **Stale inventory** — candidates suppressed for `inventory_stale`.
- **Knowledge conflicts** — candidates suppressed due to conflicting sources.
- **Provider failures** — provider-error count and rate.
- **Queue depth** — number of candidates in `pending`/`revalidating`.
- **Oldest queued item** — age of the oldest unprocessed candidate (against the 15-minute `expires_at`).
- **Retry count** — attempts per candidate (`ai_send_attempts.attempt_no`).
- **Dead-letter count** — candidates in `dead_letter`.
- **Duplicate-prevention events** — idempotency-key conflicts avoided (a duplicate inbound that did not create a second candidate).
- **Usage-limit breaches** — per-tenant usage-limit hits.
- **Kill-switch activations** — count and scope of `responder.killswitch.activated` audit actions.

## 2. Documented alert queries (interfaces, not active alarms)

The following are the _shape_ of the alerts to configure once a monitoring backend exists. They are described as conditions over the recorded data; the exact SQL/metric expressions are finalized when the live project and monitoring provider are chosen. None of these is firing today.

- **Any non-zero real send while record-only** — alert if the delivered/sent count is ever > 0 (it must be structurally impossible; an alert here would indicate a serious invariant breach). The `summarizeLiveSendEvaluations` headline `delivered` count is the canonical signal and must stay 0.
- **Cross-tenant leakage indicator** — alert on any candidate/attempt whose tenant scope does not match its conversation's tenant (RLS should make this impossible; the alert is a backstop).
- **Grounding failure spike** — alert when `not_grounded` + `citation_incomplete` rate exceeds the approved threshold.
- **Escalation rate anomaly** — alert when escalation rate moves outside the approved band (too high or implausibly low).
- **Provider error rate** — alert when provider failures exceed the threshold.
- **Queue backlog** — alert when queue depth or oldest-queued-item age exceeds the threshold (e.g. items approaching `expires_at`).
- **Dead-letter growth** — alert on any increase in `dead_letter` candidates.
- **Retry storm** — alert when attempts-per-candidate exceeds the cap.
- **Duplicate-send candidate** — alert on any confirmed duplicate-send candidate (must be zero).
- **DNC / consent violation** — alert on any send candidate that proceeded despite a DNC/consent block (must be zero).
- **Usage-limit breach** — alert when a tenant hits its usage limit.
- **Kill-switch activation** — notify on every `responder.killswitch.activated` so operators are aware a scope was halted.

## 3. Honest statement of current state

To be unambiguous: **there is no active production alerting for the responder.** No monitoring provider is configured, no alarm fires, and no page is sent. The metrics above are computed from data the system records, and the alert queries are documented interfaces to be wired in 5B.1 alongside the live-send PR. Until then the responder is record-only, real sends are impossible, and the dashboards would show simulated activity only. The thresholds referenced above are the same configurable, written-approval-gated thresholds described in [`AI_ROLLOUT_PLAN.md`](./AI_ROLLOUT_PLAN.md) — no production numbers are set here.
