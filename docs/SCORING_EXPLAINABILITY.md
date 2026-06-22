# Scoring Explainability (Phase 6A)

Every score has an explanation. A user must be able to answer, for any lead: **Why is this lead Hot? What changed? Which rule contributed? Which data is missing? Which evidence is stale? Was it overridden?** This document defines how the deterministic engine and the schema make those answers available, and the guarantee that there are no unexplained score changes.

It complements [`SCORING_ARCHITECTURE.md`](./SCORING_ARCHITECTURE.md), [`SCORING_RULES.md`](./SCORING_RULES.md), and [`SCORING_SIGNALS.md`](./SCORING_SIGNALS.md).

---

## 1. Every score carries its explanation

`calculateLeadScore` returns a `LeadScoreResult` that is self-explaining. Alongside the numeric `score` and `classification`, it carries:

- **components** — the per-rule contributions (group, signal, points, applied/skipped, reason, explanation text).
- **appliedRules** / **skippedRules** — exactly which rules fired and which did not, with reasons.
- **missingSignals** — the signals that were unknown and therefore contributed zero.
- **contradictions** — the contradictory signals that forced review.
- **disqualification** — whether the lead is disqualified and why.
- **reviewRequired** — whether review is forced and why.
- **evidenceCompleteness** and **calculationConfidence** — tracked separately from the score.
- **qualificationComplete** — whether required evidence is complete (a high score does not imply this).
- **explanation** — a human-readable, ordered narrative of how the score was reached.
- **modelVersion** and **calculatedAt** — what produced the result and when.

The per-rule contributions are persisted to `lead_score_components` (group, signal, contribution, applied flag, skipped reason, explanation), so the explanation survives outside the in-memory result.

## 2. Answering the explainability questions

- **Why is this lead Hot?** — the classification plus the `components` of the contributing groups (intent, fit, urgency/freshness, engagement) and the `explanation` narrative show which positive rules drove it above the Hot threshold.
- **What changed?** — the `lead_score_history` timeline records each delta (previous/new score and classification) with the `trigger` that caused it and the model version in force.
- **Which rule contributed?** — `appliedRules` and `lead_score_components` name the exact rules and their point contributions; `skippedRules` explains the non-contributors.
- **Which data is missing?** — `missingSignals` lists the unknown signals; these reduce `evidenceCompleteness` without penalising the score.
- **Which evidence is stale?** — observations in the `stale` state (and expired observations) reduce `calculationConfidence`; the panel surfaces them so a user knows the score rests on aging data.
- **Was it overridden?** — the effective score overlays any active `lead_score_overrides` row (with its reason, actor, and expiry) on the calculated values, which remain visible underneath; an expired override is ignored.

## 3. Score history timeline

`lead_score_history` is append-only and provides the timeline. Each row records:

- the run it belongs to;
- previous and new score;
- previous and new classification;
- the trigger that caused the change;
- the model version in force;
- the actor (for manual actions);
- the timestamp.

Because history is never overwritten, the full sequence of "what the score was, why it changed, and under which version" is always reconstructable.

## 4. Calculated score vs effective score

- The **calculated score** is the machine opinion from `calculateLeadScore`, persisted as a `lead_score_runs` row stamped with the exact model version.
- The **effective score** is what a human acts on: `effectiveScore` overlays a manual override on top of the calculated values. Expired overrides are ignored, and the calculated values are always preserved beneath the override.

Both are shown so a reviewer can see the machine's opinion and the human's adjustment side by side, never one silently replacing the other.

## 5. No unexplained changes

Every score run records its trigger and model version; every change is captured as a history delta with its cause; every contribution is a named, persisted component; and every manual override records a reason, an actor, and an expiry. There is therefore **no path** by which a score can change without a recorded, attributable, human-readable reason. Combined with determinism (identical inputs reproduce identical results) and version stamping (the rules that produced a historical score are immutable), this guarantees the score timeline is fully explainable after the fact.
