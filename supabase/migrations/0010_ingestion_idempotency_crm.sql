-- 0010_ingestion_idempotency_crm.sql
-- Phase 3.1 — CRM Conversation Readiness. Database-enforced ingestion
-- idempotency, durable-workflow tables (outbox), public-form security, calls,
-- saved views, qualification config, and lead custom fields. Tenant-scoped, RLS
-- default-deny. Live PGMQ/Realtime/Storage remain deferred; the structures and
-- security rules they will use exist now.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.ingestion_status as enum (
  'received', 'queued', 'processing', 'completed', 'rejected', 'retry_scheduled', 'dead_letter', 'cancelled'
);
create type public.job_status as enum (
  'pending', 'processing', 'completed', 'failed', 'retry_scheduled', 'dead_letter', 'cancelled'
);
create type public.public_form_status as enum ('draft', 'active', 'paused', 'archived');
create type public.call_direction as enum ('inbound', 'outbound');
create type public.call_status as enum (
  'connected', 'no_answer', 'busy', 'wrong_number', 'switched_off', 'callback_requested', 'cancelled'
);
create type public.qualification_importance as enum ('required', 'important', 'optional', 'disabled');
create type public.saved_view_scope as enum ('private', 'team', 'tenant');

-- ---------------------------------------------------------------------------
-- Idempotency + durable ingestion
-- ---------------------------------------------------------------------------
create table public.idempotency_keys (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  scope text not null,
  idem_key text not null,
  payload_hash text,
  lead_id uuid,
  status text,
  created_at timestamptz not null default now(),
  unique (tenant_id, scope, idem_key)
);

create table public.lead_ingestion_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid references public.lead_sources(id) on delete set null,
  external_event_id text,
  idempotency_key text not null,
  payload_hash text not null,
  original_payload jsonb not null,
  normalized_payload jsonb,
  status public.ingestion_status not null default 'received',
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  resulting_lead_id uuid references public.leads(id) on delete set null,
  last_error_code text,
  error_summary text,
  correlation_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Core idempotency: one event per (tenant, key).
  unique (tenant_id, idempotency_key)
);
-- External-id dedupe within a tenant + source (when provided).
create unique index idx_ingestion_external
  on public.lead_ingestion_events (tenant_id, source_id, external_event_id)
  where external_event_id is not null;
create index idx_ingestion_status on public.lead_ingestion_events (tenant_id, status);

create table public.lead_ingestion_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.lead_ingestion_events(id) on delete cascade,
  attempt_no integer not null,
  status public.ingestion_status not null,
  error_code text,
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index idx_ingestion_attempts_event on public.lead_ingestion_attempts (event_id);

create table public.background_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),
  correlation_id text,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_jobs_ready on public.background_jobs (status, next_run_at);
create trigger trg_jobs_updated before update on public.background_jobs
  for each row execute function public.set_updated_at();

create table public.dead_letter_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  origin text not null check (origin in ('job', 'ingestion')),
  origin_id uuid,
  job_type text,
  payload jsonb not null default '{}'::jsonb,
  error text,
  correlation_id text,
  created_at timestamptz not null default now(),
  replayed_at timestamptz
);
create index idx_dlq_tenant on public.dead_letter_events (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Public-form security
-- ---------------------------------------------------------------------------
create table public.public_lead_forms (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  project_id uuid references public.projects(id) on delete set null,
  source_id uuid references public.lead_sources(id) on delete set null,
  campaign text,
  status public.public_form_status not null default 'draft',
  secret_hash text,
  allowed_origins text[] not null default '{}',
  rate_limit_per_min integer not null default 30 check (rate_limit_per_min > 0),
  privacy_notice_version text,
  consent_required boolean not null default true,
  honeypot_field text not null default 'website',
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
create index idx_public_forms_tenant on public.public_lead_forms (tenant_id);

create table public.public_lead_form_domains (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null references public.public_lead_forms(id) on delete cascade,
  domain text not null
);
create index idx_form_domains_form on public.public_lead_form_domains (form_id);

create table public.public_lead_form_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid references public.public_lead_forms(id) on delete set null,
  status text not null check (status in ('accepted', 'rejected')),
  reason text,
  correlation_id text,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index idx_form_submissions_form on public.public_lead_form_submissions (form_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Saved views
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  entity text not null default 'leads',
  name text not null,
  scope public.saved_view_scope not null default 'private',
  filters jsonb not null default '{}'::jsonb,
  sort jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  page_size integer not null default 50,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_saved_views_tenant on public.saved_views (tenant_id, entity);
create trigger trg_views_updated before update on public.saved_views
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create table public.calls (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid references public.profiles(id) on delete set null,
  direction public.call_direction not null default 'outbound',
  status public.call_status not null,
  started_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  outcome text,
  notes text,
  callback_requested boolean not null default false,
  callback_at timestamptz,
  next_action text,
  created_at timestamptz not null default now()
);
create index idx_calls_lead on public.calls (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Qualification config + values, and lead custom fields
-- ---------------------------------------------------------------------------
create table public.qualification_fields (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_key text not null,
  label text not null,
  importance public.qualification_importance not null default 'optional',
  sort_order integer not null default 0,
  unique (tenant_id, field_key)
);

create table public.lead_qualification_values (
  lead_id uuid not null references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_key text not null,
  value text,
  primary key (lead_id, field_key)
);

create table public.lead_custom_fields (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  sort_order integer not null default 0,
  unique (tenant_id, field_key)
);

create table public.lead_custom_field_values (
  lead_id uuid not null references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_id uuid not null references public.lead_custom_fields(id) on delete cascade,
  value text,
  primary key (lead_id, field_id)
);

-- Seed default qualification fields per tenant (idempotent) + provision on create.
create or replace function public.seed_default_qualification_fields(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.qualification_fields (tenant_id, field_key, label, importance, sort_order) values
    (p_tenant, 'full_name',          'Full name',          'required',  1),
    (p_tenant, 'primary_phone',      'Phone',              'required',  2),
    (p_tenant, 'primary_email',      'Email',              'important', 3),
    (p_tenant, 'preferred_language', 'Preferred language', 'optional',  4),
    (p_tenant, 'budget',             'Budget',             'important', 5),
    (p_tenant, 'configuration',      'Configuration',      'important', 6),
    (p_tenant, 'preferred_location', 'Preferred location', 'important', 7),
    (p_tenant, 'purchase_timeline',  'Purchase timeline',  'important', 8),
    (p_tenant, 'purpose',            'Purchase purpose',   'optional',  9),
    (p_tenant, 'interest_project',   'Project of interest','optional',  10)
  on conflict (tenant_id, field_key) do nothing;
end; $$;

create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  perform public.seed_default_pipeline(new.id);
  perform public.seed_default_qualification_fields(new.id);
  return new;
end; $$;

do $$ declare t record; begin
  for t in select id from public.tenants loop
    perform public.seed_default_qualification_fields(t.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- New audit actions (mirrors @re/validation)
-- ---------------------------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('lead.ingest',          'configuration', 'Lead ingested via API/webhook/form', false),
  ('call.log',             'configuration', 'Call logged',                         false),
  ('view.save',            'configuration', 'Saved view created/updated',          false),
  ('form.config.update',   'configuration', 'Public form configured',              false),
  ('ingestion.dead_letter','integration',   'Ingestion event dead-lettered',       true),
  ('job.replay',           'integration',   'Background job/event replayed',        true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.idempotency_keys            enable row level security;
alter table public.lead_ingestion_events       enable row level security;
alter table public.lead_ingestion_attempts     enable row level security;
alter table public.background_jobs             enable row level security;
alter table public.dead_letter_events          enable row level security;
alter table public.public_lead_forms           enable row level security;
alter table public.public_lead_form_domains    enable row level security;
alter table public.public_lead_form_submissions enable row level security;
alter table public.saved_views                 enable row level security;
alter table public.calls                       enable row level security;
alter table public.qualification_fields        enable row level security;
alter table public.lead_qualification_values   enable row level security;
alter table public.lead_custom_fields          enable row level security;
alter table public.lead_custom_field_values    enable row level security;

-- Ingestion infra: READ-ONLY for tenant ops (no write policies; service role writes).
-- idempotency_keys carry no policy => not directly readable by tenant users.
create policy ingestion_events_sel on public.lead_ingestion_events for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.team'));
create policy ingestion_attempts_sel on public.lead_ingestion_attempts for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.team'));
create policy jobs_sel on public.background_jobs for select
  using (
    tenant_id is not null and public.is_active_member(tenant_id)
    and public.has_permission('settings.audit.read')
  );
create policy dlq_sel on public.dead_letter_events for select
  using (
    tenant_id is not null and public.is_active_member(tenant_id)
    and public.has_permission('settings.audit.read')
  );

-- Public forms: managed with forms.manage.
create policy forms_sel on public.public_lead_forms for select
  using (public.is_active_member(tenant_id) and public.has_permission('forms.manage'));
create policy forms_write on public.public_lead_forms for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('forms.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('forms.manage'));
create policy form_domains_sel on public.public_lead_form_domains for select
  using (public.is_active_member(tenant_id) and public.has_permission('forms.manage'));
create policy form_domains_write on public.public_lead_form_domains for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('forms.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('forms.manage'));
create policy form_subs_sel on public.public_lead_form_submissions for select
  using (public.is_active_member(tenant_id) and public.has_permission('forms.manage'));

-- Saved views: own always; team/tenant scopes visible to permitted members. A
-- view stores only filters — it can never widen the user's leads RLS.
create policy views_select on public.saved_views for select
  using (
    public.is_active_member(tenant_id) and (
      owner_id = auth.uid()
      or scope = 'tenant'
      or (scope = 'team' and public.has_permission('leads.read.team'))
    )
  );
create policy views_write on public.saved_views for all
  using (tenant_id = public.current_tenant_id() and owner_id = auth.uid())
  with check (tenant_id = public.current_tenant_id() and owner_id = auth.uid());

-- Calls: visible ONLY if the lead is visible (lead RLS filters the subquery).
-- Write policies are split per-command so they never widen SELECT visibility:
-- a `for all` write policy would also grant SELECT on every tenant call to any
-- holder of calls.manage, bypassing the lead-scoped read rule.
create policy calls_select on public.calls for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy calls_insert on public.calls for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('calls.manage')
    and exists (select 1 from public.leads l where l.id = lead_id)
  );
create policy calls_update on public.calls for update
  using (
    tenant_id = public.current_tenant_id()
    and public.has_permission('calls.manage')
    and exists (select 1 from public.leads l where l.id = lead_id)
  )
  with check (tenant_id = public.current_tenant_id() and public.has_permission('calls.manage'));
create policy calls_delete on public.calls for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('calls.manage'));

-- Qualification config + custom-field defs: read by lead-area members; configured by admin.
create policy qual_fields_sel on public.qualification_fields for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy qual_fields_write on public.qualification_fields for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));
create policy custom_fields_sel on public.lead_custom_fields for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy custom_fields_write on public.lead_custom_fields for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));

-- Per-lead values: inherit the parent lead's visibility; written with leads.update.
create policy qual_values_sel on public.lead_qualification_values for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy qual_values_write on public.lead_qualification_values for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));
create policy custom_values_sel on public.lead_custom_field_values for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy custom_values_write on public.lead_custom_field_values for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));

grant select, insert, update, delete on
  public.public_lead_forms, public.public_lead_form_domains, public.saved_views,
  public.calls, public.qualification_fields, public.lead_qualification_values,
  public.lead_custom_fields, public.lead_custom_field_values
  to authenticated;
grant select on
  public.lead_ingestion_events, public.lead_ingestion_attempts,
  public.background_jobs, public.dead_letter_events, public.public_lead_form_submissions
  to authenticated;
