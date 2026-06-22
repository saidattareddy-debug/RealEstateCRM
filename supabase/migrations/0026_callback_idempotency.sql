-- =====================================================================
-- Phase 7A — delivery-callback idempotency anchors (forward-only; 0024/0025
-- unchanged). Callbacks are tenant-scoped: a provider message reference in one
-- tenant must never resolve a message in another tenant. The same provider event
-- under two separate tenants may be stored separately (tenant-scoped identifiers).
-- Still record-only / no external IO.
-- =====================================================================

-- One recorded provider event per (tenant, provider message ref, callback kind):
-- a duplicate callback of the same kind for the same provider message is blocked.
-- (Partial — only when a provider reference is present.)
create unique index if not exists uniq_wa_provider_event_ref_kind
  on public.whatsapp_provider_events (tenant_id, provider_message_ref, kind)
  where provider_message_ref is not null;

-- Fast tenant-scoped lookup of the latest delivery row by provider reference
-- (the callback processor resolves the message to advance via this index).
create index if not exists idx_message_delivery_provider_ref
  on public.message_delivery_events (tenant_id, provider_ref, created_at desc)
  where provider_ref is not null;
