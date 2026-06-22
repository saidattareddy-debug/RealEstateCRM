# Scoring Signals (Phase 6A)

This document defines the signal model that feeds deterministic scoring: the signal catalogue by category, the signal states, the observation provenance fields, and the rule that lead source influences scoring only through tenant-approved rules and never alone proves quality.

It complements [`SCORING_RULES.md`](./SCORING_RULES.md) and [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md).

---

## 1. Signal catalogue by category

Signals are grouped by the category that a rule reading them belongs to. The concrete Phase 6A signals are:

### Intent

- Requests a site visit.
- Asks about the booking procedure.
- Requests current availability.
- Requests a price sheet / payment plan.
- Requests a callback.
- Requests a floor plan / brochure.
- Asks detailed project-comparison questions.

### Fit

- Budget fits available inventory (and the tiered "within X% of minimum" bands).
- Configuration match (exact / category).
- Preferred location or project match.
- Purchase purpose captured.
- Important amenity match.

### Engagement

- Confirms a callback or site visit.
- Responds promptly.
- Has several meaningful exchanges.
- Opens or requests relevant material.
- Returns to the conversation.

### Source quality

- Lead source / channel.
- Campaign provenance.

(Source signals only influence the score through tenant-approved rules; see §4.)

### Negative

- Rental-only requirement.
- Job seeker / vendor / spam intent.
- Explicit opt-out.
- Invalid contact information.
- Budget far below all matching inventory with no flexibility.
- Repeated unrelated responses.

### Freshness

- Recency of the latest meaningful inbound.
- Recency of the latest activity.
- Age of an observation (staleness drives the `stale` state and reduces calculation confidence).

## 2. Signal states

Every observation carries one of six states, so the engine can reason about presence and trust rather than only value:

- **`known`** — the value is observed and trusted.
- **`unknown`** — no value is available; contributes zero and reduces evidence completeness (never disqualifies by itself).
- **`not_applicable`** — the signal does not apply to this lead/context.
- **`contradictory`** — conflicting observations exist; a contradictory critical fact forces review.
- **`stale`** — the value is past its useful recency; reduces calculation confidence.
- **`unverified`** — observed but not yet verified; usable but lower trust.

## 3. Observation provenance fields

Each recorded observation (`lead_signal_observations`) carries full provenance so a score is explainable and auditable:

- **signal definition** — which signal this observes (`signal_key`, defined in `scoring_signal_definitions`).
- **lead** — the lead the observation is about.
- **project** — the optional project the observation is scoped to.
- **value** — the observed value (`jsonb`).
- **value type** — the value's type (boolean, numeric, enum, set, date, etc.).
- **source type** — where the observation came from (system, AI extraction, agent, import, etc.).
- **source record** — the optional originating record id.
- **observation time** — when the observation was made (used by `date_recency`).
- **verification state** — verified / unverified.
- **confidence** — high / medium / low.
- **expiry** — when the observation should be treated as stale/expired.
- **superseded** — a supersede marker when a newer observation replaces this one.
- **correlation id** — ties the observation to the triggering event for traceability.

## 4. Source influences scoring only through approved rules

Lead source and campaign are recorded as signals, but **source quality alone never proves a lead is good**. Source affects the score **only** through tenant-approved scoring rules in the `source` group, bounded by that group's cap. A lead is not promoted to Hot because it arrived from a "good" channel; it is promoted because intent, fit, urgency, and engagement signals — read through approved rules — say so. This keeps source a contributing factor under explicit tenant control, never a silent shortcut. Source and language alone can never disqualify a lead (see [`SCORING_FAIRNESS.md`](./SCORING_FAIRNESS.md)).
