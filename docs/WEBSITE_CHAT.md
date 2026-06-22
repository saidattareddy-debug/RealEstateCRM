# Website Chat

The embeddable widget, its public endpoints, the signed-session model, and
consent/DNC. Authoritative code: `apps/web/src/app/api/chat/*`, migration `0012`
(`website_chat_widgets`, `website_chat_sessions`).

## Trust model

The browser is never trusted for tenant, conversation, lead, project, or agent
ids. `widgetId` is the widget's **public key** (safe to embed). Internal ids are
resolved server-side from the widget + session context using the service role;
public responses are non-disclosing (never reveal whether a contact exists, never
leak tenant/lead/conversation ids or DB errors).

## Sessions (signed-token model)

`website_chat_sessions` holds a `public_session_id`, a `token_hash` (the raw token
is never stored), `token_version`, `expires_at`, `rotated_at`, an anonymous
visitor id, lead-association time, and language/project/page/UTM/consent context.
Planned operations: new session, returning session (resume by token), expiry,
token rotation, clear chat, lead association, conversation resume. The harness
verifies session visibility is gated by `website_chat.view_sessions`.

**Status: implemented** (`apps/web/src/lib/chat/session.ts`). `/api/chat/start`
mints a session and returns ONLY an opaque token + public session id;
`/api/chat/message` resolves the conversation **from the token alone** (scoped to
widget + tenant) — a modified, rotated, expired, cross-widget, or cross-tenant
token cannot resolve. Sessions slide their `last_seen_at`/expiry, support
rotation (`rotateWebsiteSession`, previous-token invalidation) and clear-chat
(`/api/chat/clear`). Only the SHA-256 hash of the token is stored. Domain logic is
unit-tested; the harness asserts the scoped binding and every rejection case. The
token-rotation **settings button** is the one remaining UI bit (`TECH_DEBT.md`).

## Endpoints (hardened, public)

`POST /api/chat/[widgetId]/start` and `POST /api/chat/[widgetId]/message`
enforce origin allow-list, size cap, rate limit, timestamp window, honeypot, and
consent; ingest the lead idempotently and append inbound messages. They return
only an opaque session id / ack.

## Installation (planned)

```html
<script src="https://app.example.com/widget.js" data-widget-id="public_widget_id"></script>
```

`/widget.js`, `/chat/widget/[widgetId]`, the settings install page (embed snippet,
allowed domains, preview, test mode, status, token-rotation, checklist, CSP
guidance, troubleshooting), and a clearly-labelled `/chat/demo` are tracked in
`TECH_DEBT.md`. No internal tenant id is ever exposed.

## Consent / DNC

`consent_events` (privacy/contact/marketing granted/withdrawn, preference
updated) and `do_not_contact_entries` (channel, scope, reason, active, activated/
resolved by+time) model the lifecycle. An active DNC blocks prohibited outbound
messaging (`isContactable`), and the reply composer shows the blocking reason.
Removal requires `dnc.manage` and a reason; every change is audited. Whether a
tenant's website _transactional_ replies remain allowed under DNC is a tenant
policy — no legal assumption is hardcoded.

## Phase 4.1 final wiring (2026-06-19)

Visitor read semantics are explicit: the messages endpoint marks outbound messages read **only** when the widget sends an `ackMessageId` while the panel is presented. A collapsed widget keeps polling (delivery) without acking, so unread accumulates; cross-session / expired / rotated tokens cannot ack; internal notes and redacted bodies never enter the unread count. The embed launcher (`widget.js`) shows a real unread badge fed by the iframe via same-origin `postMessage`, and signals open/closed state so acknowledgement only happens while the panel is open. Widget admin (pause/resume, revoke-all-sessions, rotate-credential) audits every action and never exposes tokens, hashes, or internal ids.
