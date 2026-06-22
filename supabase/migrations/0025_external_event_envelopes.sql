-- =====================================================================
-- Phase 7A correctness closeout — TRUE persist-before-process.
-- Forward-only (0024 unchanged). Adds the authenticated inbound ENVELOPE that
-- is persisted BEFORE the provider adapter is invoked, an opaque public webhook
-- endpoint id, and a link from normalized events back to their envelope.
-- Still record-only / no external IO. No delivery constraint widened.
-- =====================================================================

create type public.external_envelope_status as enum (
  'received', 'parsing', 'normalized', 'processing', 'processed', 'duplicate',
  'failed_retryable', 'failed_permanent', 'dead_letter', 'replay_requested',
  'replayed', 'resubmission_required');

create table public.external_event_envelopes (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_connection_id uuid not null references public.integration_connections(id) on delete cascade,
  webhook_endpoint_id uuid references public.channel_webhook_endpoints(id) on delete set null,
  provider public.integration_provider not null,
  received_at timestamptz not null default now(),
  authenticated_at timestamptz,
  request_method text,
  content_type text,
  content_length integer,
  body_hash text not null,
  signature_scheme text,
  signature_timestamp timestamptz,
  correlation_id text,
  -- One authenticated receipt → one durable envelope (concurrency-safe).
  receipt_idempotency_key text not null,
  processing_status public.external_envelope_status not null default 'received',
  attempt_count integer not null default 0,
  adapter_version text,
  mapping_version_id uuid,
  retention_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_category text,
  safe_failure_summary text,
  unique (tenant_id, receipt_idempotency_key)
);
create index idx_external_event_envelopes
  on public.external_event_envelopes (tenant_id, integration_connection_id, processing_status);

-- Opaque, rotatable public webhook endpoint identifier (NOT derived from tenant
-- or connection ids). Providers post to /api/integrations/webhooks/<public_id>.
alter table public.channel_webhook_endpoints
  add column public_id text not null default encode(extensions.gen_random_bytes(16), 'hex');
create unique index uniq_channel_webhook_public_id on public.channel_webhook_endpoints (public_id);

-- Link a normalized event back to the envelope it came from (forward-only).
alter table public.external_events
  add column envelope_id uuid references public.external_event_envelopes(id) on delete set null;

alter table public.external_event_envelopes enable row level security;
-- Read with integrations.events.read; writes are server-role only (no client policy).
create policy eee_sel on public.external_event_envelopes for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('integrations.events.read'));

insert into public.audit_actions (key, category, description, is_security) values
  ('integration.envelope.received', 'configuration', 'Authenticated webhook envelope persisted', false),
  ('integration.envelope.resubmission_required', 'configuration', 'Parse failure — resubmission required (not replayable)', false)
on conflict (key) do nothing;
