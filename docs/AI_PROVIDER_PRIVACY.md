# AI Provider Privacy & Model Pinning

What must be true about data handling and provider configuration **before** any real AI provider credential is activated. In Phase 5B.0 no real provider is configured — the default is a deterministic mock, and provider configuration stores only a `secret_ref` (an env-var _name_), never a secret value (see [`AI_PROVIDERS.md`](./AI_PROVIDERS.md) and [`AI_SECURITY.md`](./AI_SECURITY.md) §2). This document defines the data-minimization and pinning requirements that gate the eventual 5B.1 credential activation. Because no customer text leaves the platform today, none of these obligations are yet triggered; they are prerequisites for going live.

---

## 1. Data minimization before any future credential activation

Before a real credential is activated, the following must be settled and documented:

- **Minimal conversation excerpt, not full lead records.** Only the conversation excerpt required to answer is sent to the provider — never the full lead record (no full contact history, no internal notes, no scoring internals, no cross-conversation data).
- **PII redaction.** Personally identifying details not needed for the answer are redacted before the request leaves the platform.
- **Provider retention + training-use policy.** The provider's data-retention window and whether submitted data may be used for training must be confirmed in writing; training-use on customer data must be disabled.
- **Regional processing.** The processing region must satisfy the tenant's data-residency requirements.
- **DPA / contract status.** A Data Processing Agreement (or equivalent) must be in place before live traffic.
- **Prompt / response retention.** The platform's own retention of prompts and responses must be defined and bounded; sensitive content is not retained longer than needed.
- **Deletion / subject-access.** Deletion and data-subject-access requests must be honourable end to end, including any provider-side copies.
- **Secret rotation.** A rotation procedure for the provider credential must exist.
- **Credential revocation.** A revocation path must exist that immediately stops provider calls (and is consistent with the kill-switch model in [`AI_KILL_SWITCH.md`](./AI_KILL_SWITCH.md)).

These are legal/compliance and product obligations; they are not satisfiable by code alone and are part of the go-live sign-off ([`PHASE_5B_GO_LIVE_CHECKLIST.md`](./PHASE_5B_GO_LIVE_CHECKLIST.md)).

## 2. Model and prompt pinning

A live send candidate must record exactly which configuration produced it, so that behaviour is reproducible and a configuration change cannot silently alter customer-facing answers. A live candidate records:

- provider
- model id + version
- prompt version
- tool-policy version
- grounding-policy version
- retrieval config
- knowledge versions
- embedding-model config
- language policy
- responder-policy version

This pinning is what the idempotency key composes over (see [`AI_DELIVERY_LIFECYCLE.md`](./AI_DELIVERY_LIFECYCLE.md) §3) and what the candidate snapshots in migration 0020 (`prompt_version`, `knowledge_snapshot_id`, `grounding_version`, etc.).

## 3. Provider / model changes require a new shadow evaluation

Because behaviour is pinned to a specific provider/model/prompt/policy set, **any change to the provider or model requires a new shadow evaluation** before it may be used for live sending. A change is not a drop-in: it produces a different idempotency key, invalidates the prior soak evidence, and must re-clear the acceptance criteria in [`AI_ROLLOUT_PLAN.md`](./AI_ROLLOUT_PLAN.md) §1 before returning to live. This prevents a quiet model upgrade from sending under approval that was granted for a different model.
