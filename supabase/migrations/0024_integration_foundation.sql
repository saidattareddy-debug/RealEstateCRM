-- =====================================================================
-- Phase 7A — external integration foundation (mock / simulation / record-only).
-- Forward-only. NO external IO, NO live sending. Provider secrets are NEVER
-- stored in plaintext — only a secret reference + safe metadata. No Phase 5B
-- delivery constraint is widened; AI automatic sending remains impossible.
-- =====================================================================

-- ---- Enums -----------------------------------------------------------------
create type public.integration_provider as enum (
  'whatsapp_cloud','gmail','imap_email','meta_lead_ads','google_lead_forms',
  'nobroker','ninetynine_acres','housing','magicbricks','generic_portal',
  'generic_webhook','generic_api','manual_test');
create type public.integration_status as enum (
  'draft','unconfigured','test','connected','degraded','disabled','revoked','error');
create type public.integration_environment as enum ('development','sandbox','production');
create type public.external_event_status as enum (
  'received','processing','processed','failed','retry_scheduled','dead_letter','duplicate','rejected');
create type public.external_event_health as enum (
  'healthy','degraded','failing','expired','revoked','disabled','unconfigured','unknown');
create type public.human_outbound_state as enum ('prepared','blocked','simulated');
create type public.wa_template_status as enum (
  'draft','submitted','approved','rejected','paused','disabled','unknown');

-- ---- Integration connections ----------------------------------------------
create table public.integration_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.integration_provider not null,
  integration_kind text not null,
  display_name text not null,
  status public.integration_status not null default 'draft',
  environment public.integration_environment not null default 'development',
  external_account_ref text,
  allowed_event_types text[] not null default '{}',
  health_state public.external_event_health not null default 'unconfigured',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  disabled_at timestamptz,
  correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, display_name),
  -- Phase 7A safety: a connection may never be 'connected' (no real verification).
  constraint phase7a_no_live_status check (status <> 'connected')
);
create index idx_integration_connections on public.integration_connections (tenant_id, provider);

create table public.integration_connection_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  version integer not null,
  config jsonb not null default '{}',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, version)
);
create unique index uniq_active_connection_version
  on public.integration_connection_versions (connection_id) where active;

-- Credential METADATA only — never a plaintext secret/token/password column.
create table public.integration_credentials_metadata (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  secret_ref text not null,
  credential_type text not null,
  last_rotation_at timestamptz,
  expires_at timestamptz,
  verification_status text not null default 'unverified',
  last_verified_at timestamptz,
  fingerprint text,
  created_at timestamptz not null default now(),
  unique (connection_id, credential_type)
);

create table public.integration_health_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  health_state public.external_event_health not null,
  detail text,
  created_at timestamptz not null default now()
);
create table public.integration_sync_cursors (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  cursor_key text not null,
  cursor_value text,
  updated_at timestamptz not null default now(),
  unique (connection_id, cursor_key)
);
create table public.integration_rate_limit_states (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  limited boolean not null default false,
  unique (connection_id, window_start)
);

-- ---- External events (persist-before-process) ------------------------------
create table public.external_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.integration_provider not null,
  connection_id uuid references public.integration_connections(id) on delete set null,
  external_account_ref text,
  external_event_id text not null,
  event_type text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload_version text,
  normalized_payload jsonb,
  raw_payload_reference text,
  payload_hash text not null,
  idempotency_key text not null,
  correlation_id text,
  status public.external_event_status not null default 'received',
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One inbound provider event → one normalized event (idempotency).
  unique (tenant_id, idempotency_key)
);
create index idx_external_events on public.external_events (tenant_id, provider, status, received_at desc);

create table public.external_event_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  status public.external_event_status not null,
  detail text,
  created_at timestamptz not null default now(),
  unique (event_id, attempt_no)
);
create table public.external_event_failures (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  failure_class text not null,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now()
);
create table public.external_event_dead_letters (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
create table public.external_event_replays (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  adapter_version text,
  mapping_version text,
  state text not null default 'requested',
  created_at timestamptz not null default now()
);
create table public.external_identity_links (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.integration_provider not null,
  external_account_ref text,
  external_identity text not null,
  normalized_phone text,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  ambiguous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, external_identity)
);

-- ---- Channels --------------------------------------------------------------
create table public.communication_channels (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  channel_kind text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.channel_webhook_endpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  public_path text not null,
  secret_ref text,
  verification_token_ref text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (public_path)
);

-- ---- WhatsApp --------------------------------------------------------------
create table public.whatsapp_business_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  external_waba_ref text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_waba_ref)
);
create table public.whatsapp_phone_numbers (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  waba_id uuid not null references public.whatsapp_business_accounts(id) on delete cascade,
  external_phone_ref text not null,
  display_phone text,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_phone_ref)
);
create table public.whatsapp_message_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  provider_template_ref text,
  name text not null,
  language text not null default 'en',
  category text,
  status public.wa_template_status not null default 'draft',
  last_synced_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, name, language)
);
create table public.whatsapp_template_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.whatsapp_message_templates(id) on delete cascade,
  version integer not null,
  components jsonb not null default '[]',
  variable_schema jsonb not null default '{}',
  status public.wa_template_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (template_id, version)
);
create table public.whatsapp_conversation_windows (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  last_inbound_at timestamptz,
  policy_state text not null default 'policy_unknown',
  policy_version text,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.whatsapp_provider_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid references public.external_events(id) on delete cascade,
  provider_message_ref text,
  kind text,
  created_at timestamptz not null default now()
);

-- ---- Email -----------------------------------------------------------------
create table public.email_mailbox_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  mailbox_address text not null,
  requested_scopes text[] not null default '{}',
  watch_expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, mailbox_address)
);
create table public.email_sync_states (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mailbox_id uuid not null references public.email_mailbox_connections(id) on delete cascade,
  history_cursor text,
  last_sync_at timestamptz,
  last_history_read_at timestamptz,
  unique (mailbox_id)
);
create table public.email_provider_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid references public.external_events(id) on delete cascade,
  provider_message_id text,
  thread_id text,
  created_at timestamptz not null default now()
);
create table public.email_parsing_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  name text not null,
  adapter text not null,
  version integer not null default 1,
  config jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.email_parsing_results (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid references public.external_events(id) on delete cascade,
  rule_id uuid references public.email_parsing_rules(id) on delete set null,
  parser_version text,
  confidence text,
  parsed jsonb,
  review_required boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---- External source adapters & mappings -----------------------------------
create table public.external_source_adapters (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.integration_provider not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, name)
);
create table public.external_source_adapter_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  adapter_id uuid not null references public.external_source_adapters(id) on delete cascade,
  version integer not null,
  fixture_checksum text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (adapter_id, version)
);
create table public.external_source_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_ref text not null,
  project_id uuid references public.projects(id) on delete set null,
  lead_source text,
  channel text,
  default_language text,
  version integer not null default 1,
  ambiguous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, source_ref, version)
);
create table public.external_campaign_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_campaign_ref text not null,
  campaign_name text,
  project_id uuid references public.projects(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_campaign_ref, version)
);
create table public.external_form_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_form_ref text not null,
  form_name text,
  project_id uuid references public.projects(id) on delete set null,
  version integer not null default 1,
  ambiguous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_form_ref, version)
);

-- ---- Human outbound (SIMULATION ONLY) --------------------------------------
create table public.human_outbound_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  channel public.integration_provider not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  body text,
  template_id uuid references public.whatsapp_message_templates(id) on delete set null,
  idempotency_key text not null,
  state public.human_outbound_state not null default 'prepared',
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create table public.human_outbound_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.human_outbound_requests(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  state public.human_outbound_state not null,
  created_at timestamptz not null default now(),
  unique (request_id, attempt_no)
);
create table public.human_outbound_simulations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.human_outbound_requests(id) on delete cascade,
  -- Always a simulation; there is no provider reference and no delivered state.
  simulated boolean not null default true,
  preview text,
  reason text,
  created_at timestamptz not null default now(),
  constraint human_outbound_is_simulation check (simulated = true)
);

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key) values
  ('integrations.read'),('integrations.manage'),('integrations.credentials.manage'),
  ('integrations.events.read'),('integrations.events.replay'),('integrations.health.read'),
  ('integrations.mappings.manage'),
  ('channels.whatsapp.read'),('channels.whatsapp.manage'),('channels.whatsapp.templates.manage'),
  ('channels.whatsapp.test'),
  ('channels.email.read'),('channels.email.manage'),('channels.email.rules.manage'),
  ('channels.email.test'),('channels.human_send.simulate')
on conflict (key) do nothing;

-- ---- RLS (parameterized) ---------------------------------------------------
do $$
declare t text;
declare manage_tables text[] := array[
  'integration_connections','integration_connection_versions','integration_credentials_metadata',
  'integration_health_events','integration_sync_cursors','integration_rate_limit_states',
  'communication_channels','channel_webhook_endpoints',
  'whatsapp_business_accounts','whatsapp_phone_numbers','whatsapp_message_templates',
  'whatsapp_template_versions','whatsapp_conversation_windows','whatsapp_provider_events',
  'email_mailbox_connections','email_sync_states','email_provider_events',
  'email_parsing_rules','email_parsing_results',
  'external_source_adapters','external_source_adapter_versions','external_source_mappings',
  'external_campaign_mappings','external_form_mappings'];
declare event_tables text[] := array[
  'external_events','external_event_attempts','external_event_failures',
  'external_event_dead_letters','external_event_replays','external_identity_links'];
declare outbound_tables text[] := array[
  'human_outbound_requests','human_outbound_attempts','human_outbound_simulations'];
begin
  foreach t in array (manage_tables || event_tables || outbound_tables) loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- Config tables: read integrations.read; write integrations.manage.
  foreach t in array manage_tables loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('integrations.read'));
      create policy %1$s_ins on public.%1$s for insert
        with check (tenant_id = public.current_tenant_id() and public.has_permission('integrations.manage'));
      create policy %1$s_upd on public.%1$s for update
        using (tenant_id = public.current_tenant_id() and public.has_permission('integrations.manage'));
    $f$, t);
  end loop;
  -- Event tables: read integrations.events.read; writes are server-role only.
  foreach t in array event_tables loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('integrations.events.read'));
    $f$, t);
  end loop;
  -- Human outbound: read integrations.read; insert needs human_send.simulate.
  foreach t in array outbound_tables loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('integrations.read'));
      create policy %1$s_ins on public.%1$s for insert
        with check (tenant_id = public.current_tenant_id() and public.has_permission('channels.human_send.simulate'));
    $f$, t);
  end loop;
end $$;

-- ---- Audit actions ---------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('integration.created','configuration','Integration created',false),
  ('integration.updated','configuration','Integration updated',false),
  ('integration.disabled','configuration','Integration disabled',true),
  ('integration.verification.attempted','configuration','Integration verification attempted',false),
  ('integration.verification.succeeded','configuration','Integration verification succeeded',false),
  ('integration.verification.failed','configuration','Integration verification failed',false),
  ('integration.secret_ref.updated','configuration','Integration secret reference updated',true),
  ('integration.webhook.verified','configuration','Webhook verified',false),
  ('integration.webhook.rejected','configuration','Webhook rejected',true),
  ('integration.event.received','configuration','External event received',false),
  ('integration.event.duplicate','configuration','External event duplicate',false),
  ('integration.event.processed','configuration','External event processed',false),
  ('integration.event.failed','configuration','External event failed',false),
  ('integration.event.dead_lettered','configuration','External event dead-lettered',true),
  ('integration.event.replayed','configuration','External event replayed',true),
  ('integration.mapping.created','configuration','Source mapping created',false),
  ('integration.mapping.activated','configuration','Source mapping activated',false),
  ('whatsapp.template.imported','configuration','WhatsApp template imported',false),
  ('whatsapp.template.status_changed','configuration','WhatsApp template status changed',false),
  ('integration.human_message.simulated','configuration','Human message simulated (not sent)',false),
  ('email.parser_rule.created','configuration','Email parser rule created',false),
  ('email.parser_rule.updated','configuration','Email parser rule updated',false),
  ('email.mailbox_watch.changed','configuration','Mailbox watch state changed',false),
  ('integration.health.changed','configuration','Integration health state changed',false)
on conflict (key) do nothing;

-- ---- Per-tenant grants + synthetic seed ------------------------------------
create or replace function public.grant_phase7a_integration_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'integrations.read','integrations.manage','integrations.credentials.manage',
          'integrations.events.read','integrations.events.replay','integrations.health.read',
          'integrations.mappings.manage','channels.whatsapp.read','channels.whatsapp.manage',
          'channels.whatsapp.templates.manage','channels.whatsapp.test','channels.email.read',
          'channels.email.manage','channels.email.rules.manage','channels.email.test',
          'channels.human_send.simulate'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'integrations.read','integrations.events.read','integrations.health.read',
          'channels.whatsapp.read','channels.whatsapp.test','channels.email.read',
          'channels.email.test','channels.human_send.simulate'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      insert into public.role_permissions (role_id, permission_key)
        values (r.id, 'channels.human_send.simulate') on conflict do nothing;
    elsif r.slug = 'marketing_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['integrations.mappings.manage','integrations.health.read']) k
        on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.seed_phase7a_integration(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.integration_connections where tenant_id = p_tenant and provider = 'manual_test') then
    return;
  end if;
  insert into public.integration_connections (tenant_id, provider, integration_kind, display_name, status, environment, health_state)
    values (p_tenant, 'manual_test', 'manual_test', 'Manual test adapter', 'test', 'development', 'unknown');
end $$;

create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  perform public.seed_default_pipeline(new.id);
  perform public.seed_default_qualification_fields(new.id);
  perform public.grant_phase41_conversation_perms(new.id);
  perform public.grant_phase5a_ai_perms(new.id);
  perform public.provision_phase5a_ai(new.id);
  perform public.grant_phase5b0_responder_perms(new.id);
  perform public.grant_phase6a_scoring_perms(new.id);
  perform public.seed_phase6a_scoring(new.id);
  perform public.grant_phase6b_matching_perms(new.id);
  perform public.seed_phase6b_matching(new.id);
  perform public.grant_phase7a_integration_perms(new.id);
  perform public.seed_phase7a_integration(new.id);
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase7a_integration_perms(t.id);
    perform public.seed_phase7a_integration(t.id);
  end loop;
end $$;
