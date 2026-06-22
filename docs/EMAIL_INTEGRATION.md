# Email Integration (Phase 7A — Foundation)

This document covers the email foundation: mailbox modelling, the deterministic
parsing pipeline, and the safety helpers for untrusted email content.

> **Phase 7A status.** Everything here is **mock / record-only** and exercised
> with **synthetic fixtures**. Phase 7A connects to **no mailbox**, runs no
> IMAP/SMTP, registers no Gmail watch / Pub/Sub, sends no rep alert, and performs
> **no external IO**. It is **credential-blocked** (no Gmail OAuth / IMAP
> credentials). The frozen safety switches are preserved
> (`LIVE_SEND_MASTER_SWITCH=false`, `RESPONDER_LIVE_SENDING=false`, advisory-only
> scoring + matching, record-only AI outbox, automatic customer sending
> impossible). Live email is **not connected**; activation is **Phase 7B**.

---

## 1. Mailbox and sync modelling

- `email_mailbox_connections` — a mailbox address per connection, with
  `requested_scopes`, a `watch_expires_at`, and a `revoked` flag.
- `email_sync_states` — a `history_cursor` and last-sync timestamps per mailbox.
- `email_provider_events` — links a normalized `external_events` row to a provider
  message / thread id.

All values are **synthetic** in 7A; no OAuth token is held (only a `secret_ref` in
`integration_credentials_metadata`), no Gmail history is read, and no Pub/Sub
watch is registered. Gmail watch / Pub/Sub and IMAP/SMTP are **Phase 7B**.

## 2. Parsing rules and results

- `email_parsing_rules` — named, versioned, per-adapter parser configs (source-
  specific or generic), audited via `email.parser_rule.created` /
  `email.parser_rule.updated`.
- `email_parsing_results` — the parsed output of a rule against an event, with a
  `confidence` and a `review_required` flag.

## 3. The deterministic portal-email parser

`parsePortalEmail(...)` is a **deterministic key:value parser**:

- it extracts only explicit `key: value` fields it actually finds — it **never
  invents fields**,
- it routes to **human review** (`review_required`) when a contact (phone/email)
  is missing rather than guessing,
- it produces a `ParsedPortalLead` shape for downstream lead creation (the lead
  creation itself is record-only in 7A).

This is intentionally not an AI parser; it is reproducible and auditable. See also
[`PORTAL_ADAPTERS.md`](./PORTAL_ADAPTERS.md).

## 4. Untrusted-content safety helpers

Email bodies are **untrusted** input (prompt-injection / phishing). The domain
provides deterministic helpers used before any email text is shown or processed:

- `stripQuotedHistory(body)` — removes quoted reply history so parsing sees only
  the new message.
- `isDangerousUrl(url)` — flags dangerous URL schemes/patterns.
- `redactSecrets(text)` — redacts secret-looking tokens from text before storage /
  logging ([`SECURITY.md`](./SECURITY.md) log redaction).

Email text is reference-only, never treated as instructions
([`AI_SECURITY.md`](./AI_SECURITY.md)).

## 5. Sender validation

Per the integration strategy, senders are validated by **domain and message
pattern**, not just display name ([`INTEGRATIONS.md`](./INTEGRATIONS.md) §5). In
7A this is exercised against synthetic fixtures only.

## 6. What is Phase 7B

Real Gmail OAuth (minimum scopes) / IMAP connection, Gmail watch + Pub/Sub,
reading real mail, sending rep alerts, and any outbound — all **Phase 7B**, gated
on tenant-supplied credentials and (for sending) the live-send sign-off.

See [`PORTAL_ADAPTERS.md`](./PORTAL_ADAPTERS.md),
[`INTEGRATION_ARCHITECTURE.md`](./INTEGRATION_ARCHITECTURE.md), and
[`INTEGRATIONS.md`](./INTEGRATIONS.md).
