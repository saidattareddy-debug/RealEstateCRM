# Assumptions & Default Decisions

Per [`MASTER_SPEC.md`](./MASTER_SPEC.md) §36–37 ("Make reasonable, documented decisions"). Every assumption below is a **configurable default**, not a hardcoded constraint. Tenant-level overrides are stored in `tenant_settings` / `tenant_features`.

---

## 1. Market & locale defaults (§36)

| Setting              | Default                                                  | Configurable         |
| -------------------- | -------------------------------------------------------- | -------------------- |
| Primary market       | India                                                    | Yes                  |
| Timezone             | Asia/Kolkata                                             | Yes (per tenant)     |
| Currency             | INR                                                      | Yes                  |
| Transactions         | Sale only (rentals classified → disqualified/redirected) | Tenant rules         |
| Primary channel      | WhatsApp                                                 | Yes                  |
| Secondary channel    | Website chat                                             | Yes                  |
| Default language     | English                                                  | Yes                  |
| Additional languages | Hindi, Kannada, Tamil, Telugu, Hinglish                  | Yes (enable/disable) |
| Themes               | Premium light (default) + optional dark                  | Yes                  |

## 2. Scoring & escalation defaults (§15, §36)

| Setting                         | Default                                                   |
| ------------------------------- | --------------------------------------------------------- |
| Hot threshold                   | 75–100                                                    |
| Warm threshold                  | 45–74                                                     |
| Cold threshold                  | 0–44                                                      |
| Disqualified                    | Approved hard rule                                        |
| Escalation confidence threshold | 0.75                                                      |
| Inventory freshness threshold   | 24 hours                                                  |
| Quiet hours                     | 8:00 PM – 9:00 AM tenant-local                            |
| Default pipeline                | The 12 stages in [`MASTER_SPEC.md`](./MASTER_SPEC.md) §22 |

## 3. Technical defaults (Phase-0 architecture decisions)

| Area                    | Default decision                                                  | Source                                               |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| AI provider integration | Provider-adapter abstraction (`packages/ai`)                      | [C7](./CONTRADICTIONS.md)                            |
| Embeddings              | Provider configured independently of chat model                   | [C8](./CONTRADICTIONS.md)                            |
| Job queue               | PGMQ + pg_cron                                                    | [C15](./CONTRADICTIONS.md)                           |
| i18n                    | next-intl + tenant terminology overrides                          | [C16](./CONTRADICTIONS.md)                           |
| Realtime                | Supabase Realtime                                                 | [C17](./CONTRADICTIONS.md)                           |
| Default chat model tier | Cheap for classify/extract, strong for reasoning                  | [`AI_SYSTEM.md`](./AI_SYSTEM.md)                     |
| Chunking                | 500–800 tokens, 80–120 overlap, keep heading/page                 | [`AI_SYSTEM.md`](./AI_SYSTEM.md)                     |
| Phone storage           | E.164 + national form                                             | [`DATABASE.md`](./DATABASE.md)                       |
| Deployment              | Vercel (web) + Supabase (data); shared & dedicated modes          | [`ARCHITECTURE.md`](./ARCHITECTURE.md)               |
| Library versions        | "Current stable, mutually compatible", pinned in Phase 1 lockfile | [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) |

## 4. Behavioural assumptions

- **Reactive WhatsApp replies** are immediate even during quiet hours (buyer-initiated); **proactive** follow-ups respect quiet/working hours. [C4](./CONTRADICTIONS.md)
- **Auto-merge** of exact duplicates is **off by default** for new tenants (review-queue first) until they opt in, to avoid surprising merges. Configurable.
- **Score clamps** to [0, 100]; hard-disqualification bypasses the numeric path. [C1](./CONTRADICTIONS.md), [C2](./CONTRADICTIONS.md)
- **Predictive scoring** is **off** until a tenant has sufficient validated data and explicit approval; never cross-tenant; never uses protected attributes.
- **Super Admin** holds no tenant-data permission by default; tenant access only via audited impersonation.

## 5. Data & privacy assumptions

- All non-production data is **synthetic**; no real names/phones from prototype screenshots (§28).
- Default data-retention and deletion workflows exist but exact retention windows are tenant-configurable and may be subject to local law (a legally sensitive setting — flagged, not assumed).
- Do-not-contact / opt-out is permanent and globally enforced before any outbound.

## 6. Things explicitly NOT assumed (require product-owner / external input)

- Live external credentials (Meta WhatsApp Business, Gmail/Calendar OAuth, AI provider keys, portal access).
- Commercial plan/pricing tiers and exact usage limits (modelled generically; real numbers TBD).
- Legally binding retention periods, contractual data-processing terms, and commission rules per tenant.
- Any irreversible production action (domain cutover, production data migration, paid-service commitment).

These are **build stop-conditions** tracked in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4 and surfaced when a phase reaches them.
