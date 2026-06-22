# WhatsApp Integration (Phase 7A — Foundation)

This document covers the WhatsApp Cloud foundation: inbound normalization,
template/account modelling, and the human-send simulation path.

> **Phase 7A status.** Everything here is **mock / simulation / record-only** and
> exercised with **synthetic fixtures**. Phase 7A connects to **no WhatsApp
> Business account**, registers no number, downloads no media, and sends **no
> message**. It is **credential-blocked** (no Meta WABA credentials) and
> **provider-review-blocked** (no Meta app review). The frozen safety switches are
> preserved (`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`,
> advisory-only scoring + matching, record-only AI outbox, automatic customer
> sending impossible). Live WhatsApp is **not connected**; activation is **Phase
> 7B**.

---

## 1. Account and number modelling

- `whatsapp_business_accounts` — a WABA reference (`external_waba_ref`) per
  connection.
- `whatsapp_phone_numbers` — phone numbers under a WABA
  (`external_phone_ref` / `display_phone`). **Design choice:** channel phone
  numbers are modelled as `whatsapp_phone_numbers` rather than a generic
  channel-number table.

All values stored in 7A are **synthetic**; no real WABA or number is registered.

## 2. Templates

- `whatsapp_message_templates` — template catalogue per connection, with a
  `wa_template_status` enum (`draft`, `submitted`, `approved`, `rejected`,
  `paused`, `disabled`, `unknown`).
- `whatsapp_template_versions` — versioned template content. **Design choice:**
  template **components** live as `jsonb` on `whatsapp_template_versions`
  (alongside a `variable_schema` jsonb) rather than a separate component table.

Template **sync** with Meta is **simulated** in 7A (status changes are recorded via
`whatsapp.template.imported` / `whatsapp.template.status_changed` audit actions);
real synchronization is **Phase 7B**.

## 3. Inbound normalization

`normalizeWhatsAppMessage(raw)` deterministically maps a raw WhatsApp message to a
normalized inbound shape covering `text`, `image`, `document`, `audio`, `video`,
`location`, `contact`, `interactive`, `template_response`, and `unsupported`.

Key properties:

- **Media is a provider reference only.** Binary media is never downloaded or
  stored. The normalized media carries `providerReference`, mime/filename/size/
  checksum metadata, `storageState: 'external_reference_only'`, and
  `scanState: 'not_scanned'`. **Storage and malware scanning are Phase 7B.**
- **Unsupported content is safe.** An unrecognized type becomes
  `{ type: 'unsupported', safe: true }` with a placeholder marker — it never
  fails ingestion.
- Every normalized message is marked `safe: true` and flows into the normalized
  event model ([`EXTERNAL_EVENT_MODEL.md`](./EXTERNAL_EVENT_MODEL.md)).

`whatsapp_provider_events` records the link between a normalized
`external_events` row and a provider message reference.

## 4. Delivery callbacks

Provider delivery/read callbacks are normalized through
`shouldApplyDeliveryCallback`, which is **forward-only**: it ignores regressions
and duplicate transitions while allowing terminal `failed` / `cancelled`. This
keeps a message's delivery state monotonic even with out-of-order provider
callbacks. In 7A all callbacks are synthetic.

## 5. Human send — simulation only

A rep-initiated WhatsApp send in 7A is **simulation-only**:

- recorded in `human_outbound_requests` (unique idempotency key) → attempts in
  `human_outbound_attempts` → outcome in `human_outbound_simulations` with a DB
  `CHECK (simulated = true)`,
- the domain `sendHumanMessage` result is always
  `{ simulated: true, accepted, reason, providerMessageRef: null }`,
- audited as `integration.human_message.simulated` ("Human message simulated (not
  sent)").

There is **no automatic** WhatsApp send. Whether a human send would be _allowed_
is governed by [`WHATSAPP_POLICY.md`](./WHATSAPP_POLICY.md), but even an
"allowed" evaluation produces only a simulation in 7A.

## 6. What is Phase 7B

Real WABA credentials, number registration, template review/sync with Meta, media
download + Storage + scanning, live inbound webhooks, and any live send — all
**Phase 7B**, gated on Meta provider review and tenant-supplied credentials.

See [`WHATSAPP_POLICY.md`](./WHATSAPP_POLICY.md),
[`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md), and
[`INTEGRATIONS.md`](./INTEGRATIONS.md).
