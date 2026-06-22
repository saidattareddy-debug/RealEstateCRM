# Contradictions & Resolutions

Per [`MASTER_SPEC.md`](./MASTER_SPEC.md) §34 ("Resolve contradictions before coding"). Each item is a genuine tension or ambiguity in the spec, with the resolution this build adopts. All resolutions are reversible defaults and are reflected in the relevant design doc.

---

## C1. Component sub-points exceed component caps

**Tension:** Intent items sum to ~62 but the cap is 30; Engagement items sum to ~14 but the cap is 10.
**Resolution:** Sub-points accumulate, then the **component cap is applied** (min(sum, cap)). Documented in [`SCORING_ENGINE.md`](./SCORING_ENGINE.md) §2 and unit-tested at the cap boundary.

## C2. Score range vs. negative signals

**Tension:** Score is "0–100" but negatives (−25, −7, …) could drive it below 0; positives could exceed 100 before caps.
**Resolution:** Total score is **clamped to [0, 100]** after component caps and negatives. Hard-disqualification overrides the numeric path entirely.

## C3. Budget-fit tiers are not mutually labelled

**Tension:** "fits inventory +20", "within 10% +14", "within 20% +7" could be read as additive.
**Resolution:** These are **mutually exclusive tiers**; take the single best applicable. Tested.

## C4. "Respond immediately" vs. quiet hours (8 PM–9 AM)

**Tension:** Immediate first response to WhatsApp vs. quiet-hours suppression.
**Resolution:** **Reactive replies to a buyer-initiated message are sent immediately** (within the WhatsApp 24-hour service window) regardless of quiet hours — the buyer is awake and messaging. **Proactive/automated follow-ups** (sequences, nudges, templates) respect working/quiet hours. Documented in [`AI_SYSTEM.md`](./AI_SYSTEM.md) and follow-up rules.

## C5. Deterministic thresholds vs. "temporarily classify Hot"

**Tension:** Categories are deterministic from score, yet a confirmed site-visit request may set Hot even with a low score.
**Resolution:** A **temporary category override** (`category_override` with reason + source event) can set Hot; it is explicit, audited in `score_events`, and time/condition-bounded. The underlying numeric score is unchanged. [`SCORING_ENGINE.md`](./SCORING_ENGINE.md) §3.

## C6. Non-response reduces score but must not disqualify

**Tension:** Non-response penalties (−3/−5/−7) vs. "do not disqualify merely for non-response."
**Resolution:** Penalties lower the score and may change **category** (e.g. to Cold) but **never trigger Disqualified**; the lead moves to **operational status Dormant/Nurturing**. Category and operational status are separate axes. Tested.

## C7. "AI SDK or provider-adapter abstraction"

**Tension:** Two options offered.
**Resolution:** Build a **clean provider-adapter abstraction** (`packages/ai`) as the stable internal contract; it _may_ use the Vercel AI SDK internally per provider, but the app depends only on our interface. Keeps Claude/OpenAI/Gemini swappable. [`AI_SYSTEM.md`](./AI_SYSTEM.md) §2.

## C8. Embeddings provider vs. the three chat providers

**Tension:** "Configurable embeddings provider" but the named providers include Anthropic, which has no first-party embeddings model.
**Resolution:** **Embeddings provider is configured independently** of the chat provider (e.g. OpenAI/Gemini/other embeddings), via the model registry. A tenant may use Claude for chat and a different provider for embeddings. [`AI_SYSTEM.md`](./AI_SYSTEM.md) §3.

## C9. "Phone without country prefix" matching risks false positives

**Tension:** Matching on the prefix-stripped number can collide across countries.
**Resolution:** Prefix-insensitive matching is used **only in combination with another identifier** (email/source ID/campaign window) or within the tenant's default country, never as a sole exact-merge key. [`INTEGRATIONS.md`](./INTEGRATIONS.md) §3, dedupe tests.

## C10. Auto-merge exact duplicates vs. "never silently delete"

**Tension:** Auto-merge vs. no silent deletion.
**Resolution:** **Merge ≠ delete.** Auto-merge (when tenant-enabled) consolidates into a canonical lead, **preserves all** child records, and writes a **reversible** `duplicate_resolution_event`. Nothing is deleted; merges can be undone. [`DATABASE.md`](./DATABASE.md) §3.4.

## C11. "Answer general questions" vs. "not a general-purpose assistant"

**Tension:** Some general domain answers allowed; general-purpose behaviour forbidden.
**Resolution:** A **whitelisted set of general real-estate topics** (carpet area, buying process, site-visit prep, basic loan terms, apartment/villa/plot differences) is allowed and **clearly labelled as general** vs. verified project info; anything outside real-estate sales or the conversation context is declined/redirected. [`AI_SYSTEM.md`](./AI_SYSTEM.md) §4.4.

## C12. Inventory "Temporarily held" vs. "Reserved"

**Tension:** Two near-synonymous statuses.
**Resolution:** Distinct semantics — **Temporarily held** = short, system/agent soft-hold (auto-expiring); **Reserved** = formal reservation pending booking. Both excluded from "available" for matching/AI. [`DATABASE.md`](./DATABASE.md) §3.3.

## C13. "No placeholder pages" vs. phased delivery

**Tension:** Spec forbids placeholder pages, but phases deliver pages incrementally.
**Resolution:** A page is only added to navigation when it is **functional and data-backed**. Not-yet-built areas are simply absent/guarded, not shipped as fake shells. Each phase's pages are real on completion. [`PAGE_MAP.md`](./PAGE_MAP.md).

## C14. Cost metrics require spend data that may be absent

**Tension:** "Cost per lead/qualified/visit/booking" needs campaign spend.
**Resolution:** Cost metrics render **only where spend data is available**; otherwise they show "spend not connected" rather than a fabricated number. Correlation is never labelled causation. [`PAGE_MAP.md`](./PAGE_MAP.md) §14.

## C15. Queues: "Supabase Queues **or** PGMQ"

**Resolution:** Use **PGMQ** (Postgres Message Queue) + `pg_cron`, transactional with data writes and portable across Supabase plans/dedicated deployments. [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4.

## C16. Localisation: "next-intl **or** equivalent"

**Resolution:** Use **next-intl** for app i18n, combined with tenant terminology overrides for white-label wording. [`UI_SYSTEM.md`](./UI_SYSTEM.md) §9.

## C17. Realtime inbox on a serverless web host

**Tension:** Vercel functions are stateless; the inbox needs live updates.
**Resolution:** Live updates come from **Supabase Realtime** (Postgres changes → client), not from long-lived Vercel connections. [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4.

## Status

No remaining contradiction blocks Phase 0 or the start of Phase 1. Any new tension found during build is added here with its resolution before the affected code is written.
