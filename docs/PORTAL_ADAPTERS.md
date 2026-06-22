# Portal & Source Adapters (Phase 7A — Foundation)

This document covers the external lead-source adapter foundation: portal / ad /
form adapters, their versioning, and the mapping tables that route an external
source to a project, campaign, or form.

> **Phase 7A status.** Everything here is **mock / record-only** and exercised
> with **synthetic fixtures**. Phase 7A pulls from **no portal** (NoBroker,
> 99acres, Housing, MagicBricks), polls no ad platform (Meta / Google lead
> forms), and performs **no external IO**. It is **credential-blocked** (no portal
> / ad-platform credentials). The frozen safety switches are preserved
> (`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`, advisory-only
> scoring + matching, record-only AI outbox, automatic customer sending
> impossible). Live source ingestion is **Phase 7B**.

---

## 1. Supported source providers

The provider enum covers the portals and ad sources: `nobroker`,
`ninetynine_acres`, `housing`, `magicbricks`, `meta_lead_ads`,
`google_lead_forms`, plus the generic `generic_portal`, `generic_webhook`,
`generic_api`, and the `manual_test` provider used for the synthetic seed.

In 7A only the deterministic **mock / failure / malformed / duplicate /
out-of-order** adapters run; real portal/ad adapters are **Phase 7B**.

## 2. Adapters and versioning

- `external_source_adapters` — a named adapter per `(tenant, provider)`.
- `external_source_adapter_versions` — versioned adapters with a
  `fixture_checksum` (the checksum of the synthetic fixture an adapter version was
  validated against) and an `active` flag.

Versioning lets a replay re-run an event through a specific adapter version
([`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md) §4).

## 3. Mapping tables

These deterministic, versioned mappings route an external reference to internal
entities (audited via `integration.mapping.created` /
`integration.mapping.activated`):

- `external_source_mappings` — `source_ref` → `project_id` / `lead_source` /
  `channel` / `default_language`, with an `ambiguous` flag.
- `external_campaign_mappings` — `external_campaign_ref` → campaign name /
  `project_id` (attribution).
- `external_form_mappings` — `external_form_ref` → form name / `project_id`, with
  an `ambiguous` flag.

When a mapping is `ambiguous`, the event is routed to human review rather than
guessed — consistent with the email parser's never-invent-fields behaviour
([`EMAIL_INTEGRATION.md`](./EMAIL_INTEGRATION.md) §3).

## 4. Identity linking

`external_identity_links` links an external identity (e.g. a normalized phone) to
a lead / conversation, with an `ambiguous` flag when the link is not unique. This
underpins deterministic dedupe of portal/ad leads into the existing lead CRM
([`LEAD_INGESTION.md`](./LEAD_INGESTION.md)) — record-only in 7A.

## 5. Deterministic, never-invent behaviour

All portal/source handling in 7A is deterministic and conservative:

- it extracts only fields actually present,
- ambiguous mappings/identities route to review,
- nothing is fabricated, and no lead is auto-assigned or auto-contacted.

## 6. What is Phase 7B

Real portal pulls / ad-platform webhooks + API pulls, real credentials, live
attribution capture, and live lead creation from external sources — all **Phase
7B**, gated on tenant-supplied credentials.

See [`EMAIL_INTEGRATION.md`](./EMAIL_INTEGRATION.md),
[`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md), and
[`INTEGRATIONS.md`](./INTEGRATIONS.md) §8.
