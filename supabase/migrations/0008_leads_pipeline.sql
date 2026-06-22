-- 0008_leads_pipeline.sql
-- Phase 3 — Lead CRM: leads, contacts, sources, attribution, pipeline, stages,
-- assignment, notes, tags, stage history, duplicates, tasks. Tenant-scoped, RLS
-- default-deny. Agent lead access is assignment-scoped; child tables inherit the
-- parent lead's visibility (the `leads` subquery in their policies enforces RLS).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.lead_operational_status as enum (
  'new', 'qualifying', 'needs_review', 'nurturing', 'dormant', 'disqualified'
);
create type public.lead_category as enum ('hot', 'warm', 'cold', 'disqualified');
create type public.duplicate_confidence as enum ('exact', 'probable', 'possible');
create type public.duplicate_status as enum ('open', 'merged', 'dismissed');
create type public.task_status as enum ('open', 'done', 'cancelled');
create type public.lead_source_kind as enum (
  'form', 'csv', 'whatsapp', 'portal', 'manual', 'api', 'webhook', 'email', 'ad'
);

-- ---------------------------------------------------------------------------
-- Authorization helper: exact permission (no read-scope implication).
-- ---------------------------------------------------------------------------
create or replace function public.has_raw_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.effective_permissions(auth.uid(), public.current_tenant_id())
    where permission_key = p_key
  );
$$;

-- ---------------------------------------------------------------------------
-- Pipeline + lookups
-- ---------------------------------------------------------------------------
create table public.pipelines (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_pipelines_tenant on public.pipelines (tenant_id);

create table public.pipeline_stages (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false
);
create index idx_stages_pipeline on public.pipeline_stages (pipeline_id, sort_order);

create table public.lost_reasons (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null
);

create table public.lead_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  kind public.lead_source_kind not null default 'manual',
  created_at timestamptz not null default now()
);
create index idx_lead_sources_tenant on public.lead_sources (tenant_id);

-- Default pipeline (12 stages) + a manual source, seeded per tenant.
create or replace function public.seed_default_pipeline(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pipeline uuid;
begin
  if exists (select 1 from public.pipelines where tenant_id = p_tenant and is_default) then
    return;
  end if;
  insert into public.pipelines (tenant_id, name, is_default)
    values (p_tenant, 'Sales Pipeline', true) returning id into v_pipeline;
  insert into public.pipeline_stages (tenant_id, pipeline_id, name, sort_order, is_won, is_lost) values
    (p_tenant, v_pipeline, 'New', 1, false, false),
    (p_tenant, v_pipeline, 'Contacted', 2, false, false),
    (p_tenant, v_pipeline, 'Qualifying', 3, false, false),
    (p_tenant, v_pipeline, 'Qualified', 4, false, false),
    (p_tenant, v_pipeline, 'Site Visit Scheduled', 5, false, false),
    (p_tenant, v_pipeline, 'Site Visit Completed', 6, false, false),
    (p_tenant, v_pipeline, 'Follow-up', 7, false, false),
    (p_tenant, v_pipeline, 'Negotiation', 8, false, false),
    (p_tenant, v_pipeline, 'Booking in Progress', 9, false, false),
    (p_tenant, v_pipeline, 'Booked', 10, true, false),
    (p_tenant, v_pipeline, 'Lost', 11, false, true),
    (p_tenant, v_pipeline, 'Disqualified', 12, false, true);
  insert into public.lead_sources (tenant_id, name, kind) values (p_tenant, 'Manual entry', 'manual');
end; $$;

-- Provision the default pipeline on tenant creation (in addition to roles).
create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  perform public.seed_default_pipeline(new.id);
  return new;
end; $$;

-- Backfill existing tenants (the seed ran before this migration existed).
do $$ declare t record; begin
  for t in select id from public.tenants loop
    perform public.seed_default_pipeline(t.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text,
  primary_phone_e164 text,
  primary_phone_national text,
  primary_email extensions.citext,
  operational_status public.lead_operational_status not null default 'new',
  category public.lead_category,
  score integer not null default 0 check (score between 0 and 100),
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  source_id uuid references public.lead_sources(id) on delete set null,
  campaign text,
  utm jsonb not null default '{}'::jsonb,
  preferred_language text,
  interest_project_id uuid references public.projects(id) on delete set null,
  lost_reason_id uuid references public.lost_reasons(id) on delete set null,
  merged_into_lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_leads_tenant on public.leads (tenant_id);
create index idx_leads_tenant_stage on public.leads (tenant_id, stage_id);
create index idx_leads_phone on public.leads (tenant_id, primary_phone_national);
create index idx_leads_email on public.leads (tenant_id, primary_email);
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

create table public.lead_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('phone', 'alt_phone', 'email')),
  value text not null,
  value_normalized text,
  is_primary boolean not null default false
);
create index idx_lead_contacts_lead on public.lead_contacts (lead_id);

create table public.lead_preferences (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  budget_min numeric(14, 2),
  budget_max numeric(14, 2),
  configuration text,
  preferred_location text,
  purchase_timeline text,
  purpose text,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.lead_source_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  source_id uuid references public.lead_sources(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_lead_source_events_lead on public.lead_source_events (lead_id);

create table public.attribution_touchpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  touch_type text not null check (touch_type in ('first', 'mid', 'last')),
  source text,
  campaign text,
  utm jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index idx_attribution_lead on public.attribution_touchpoints (lead_id);

create table public.lead_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  reason text,
  is_manual boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index idx_one_active_assignment on public.lead_assignments (lead_id) where active;
create index idx_assignments_agent on public.lead_assignments (agent_id) where active;

create table public.lead_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index idx_lead_notes_lead on public.lead_notes (lead_id, created_at desc);

create table public.lead_tags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag text not null,
  primary key (lead_id, tag)
);

create table public.lead_stage_history (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id) on delete set null,
  to_stage_id uuid references public.pipeline_stages(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_stage_history_lead on public.lead_stage_history (lead_id, created_at desc);

create table public.lead_activity_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_lead on public.lead_activity_events (lead_id, created_at desc);

create table public.lead_duplicates (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  duplicate_lead_id uuid not null references public.leads(id) on delete cascade,
  confidence public.duplicate_confidence not null,
  signals jsonb not null default '[]'::jsonb,
  status public.duplicate_status not null default 'open',
  created_at timestamptz not null default now()
);
create index idx_duplicates_open on public.lead_duplicates (tenant_id, status);

create table public.duplicate_resolution_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary_lead_id uuid not null references public.leads(id) on delete cascade,
  merged_lead_id uuid references public.leads(id) on delete set null,
  action text not null check (action in ('merge', 'dismiss', 'unmerge')),
  snapshot jsonb not null default '{}'::jsonb,
  resolved_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status public.task_status not null default 'open',
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_tasks_tenant on public.tasks (tenant_id, status);

-- ---------------------------------------------------------------------------
-- New audit actions (mirrors @re/validation)
-- ---------------------------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('lead.create',        'configuration',  'Lead created',            false),
  ('lead.update',        'configuration',  'Lead updated',            false),
  ('lead.merge',         'configuration',  'Duplicate leads merged',  true),
  ('lead.dedupe.dismiss','configuration',  'Duplicate dismissed',     false),
  ('lead.assign',        'access_control', 'Lead assigned',           false),
  ('lead.stage_change',  'configuration',  'Lead pipeline stage changed', false),
  ('lead.note.add',      'configuration',  'Note added to lead',      false),
  ('task.create',        'configuration',  'Task created',            false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the leads policy can check assignment WITHOUT triggering
-- lead_assignments' own RLS (which references leads → infinite recursion).
-- Defined here, after lead_assignments exists.
create or replace function public.current_user_assigned(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lead_assignments la
    where la.lead_id = p_lead and la.agent_id = auth.uid() and la.active
  );
$$;

alter table public.pipelines               enable row level security;
alter table public.pipeline_stages         enable row level security;
alter table public.lost_reasons            enable row level security;
alter table public.lead_sources            enable row level security;
alter table public.leads                   enable row level security;
alter table public.lead_contacts           enable row level security;
alter table public.lead_preferences        enable row level security;
alter table public.lead_source_events      enable row level security;
alter table public.attribution_touchpoints enable row level security;
alter table public.lead_assignments        enable row level security;
alter table public.lead_notes              enable row level security;
alter table public.lead_tags               enable row level security;
alter table public.lead_stage_history      enable row level security;
alter table public.lead_activity_events    enable row level security;
alter table public.lead_duplicates         enable row level security;
alter table public.duplicate_resolution_events enable row level security;
alter table public.tasks                   enable row level security;

-- Pipeline / lookups: readable by anyone who can read leads; configured by managers.
create policy pipelines_select on public.pipelines for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy pipelines_write on public.pipelines for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'));
create policy stages_select on public.pipeline_stages for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy stages_write on public.pipeline_stages for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'));
create policy lost_reasons_select on public.lost_reasons for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy lost_reasons_write on public.lost_reasons for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.configure'));
create policy lead_sources_select on public.lead_sources for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy lead_sources_write on public.lead_sources for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('sources.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sources.manage'));

-- LEADS: precise read scope (all > team > assigned-only-if-assigned).
create policy leads_select on public.leads for select
  using (
    public.is_active_member(tenant_id) and (
      public.has_raw_permission('leads.read.all')
      or public.has_raw_permission('leads.read.team')
      or (
        public.has_raw_permission('leads.read.assigned')
        and public.current_user_assigned(leads.id)
      )
    )
  );
create policy leads_insert on public.leads for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.create'));
-- Update requires both the leads.update permission AND visibility of the row
-- (so an agent can only update leads assigned to them).
create policy leads_update on public.leads for update
  using (
    tenant_id = public.current_tenant_id()
    and public.has_permission('leads.update')
    and (
      public.has_raw_permission('leads.read.all')
      or public.has_raw_permission('leads.read.team')
      or public.current_user_assigned(leads.id)
    )
  )
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));

-- Child tables inherit the parent lead's visibility (leads RLS applies to the
-- subquery). Writes are gated by an appropriate permission.
create policy lead_contacts_rw on public.lead_contacts for all
  using (exists (select 1 from public.leads l where l.id = lead_id))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));
create policy lead_preferences_rw on public.lead_preferences for all
  using (exists (select 1 from public.leads l where l.id = lead_id))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));
create policy lead_source_events_sel on public.lead_source_events for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy attribution_sel on public.attribution_touchpoints for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_activity_sel on public.lead_activity_events for select
  using (exists (select 1 from public.leads l where l.id = lead_id));

create policy lead_notes_select on public.lead_notes for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_notes_insert on public.lead_notes for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));

create policy lead_tags_select on public.lead_tags for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_tags_write on public.lead_tags for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));

create policy stage_history_select on public.lead_stage_history for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy stage_history_insert on public.lead_stage_history for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('pipeline.move'));

-- Assignments: visible if the lead is visible; managed with assign/reassign.
create policy assignments_select on public.lead_assignments for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy assignments_write on public.lead_assignments for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.has_permission('leads.assign') or public.has_permission('leads.reassign'))
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (public.has_permission('leads.assign') or public.has_permission('leads.reassign'))
  );

-- Duplicates + resolution: managed with leads.merge; readable by team-level.
create policy duplicates_select on public.lead_duplicates for select
  using (
    public.is_active_member(tenant_id)
    and (public.has_permission('leads.read.team') or public.has_permission('leads.merge'))
  );
create policy duplicates_write on public.lead_duplicates for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('leads.merge'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.merge'));
create policy dup_resolution_select on public.duplicate_resolution_events for select
  using (
    public.is_active_member(tenant_id)
    and (public.has_permission('leads.read.team') or public.has_permission('leads.merge'))
  );
create policy dup_resolution_insert on public.duplicate_resolution_events for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.merge'));

-- Tasks: visible if the lead is visible (or tenant tasks with no lead); managed with tasks.manage.
create policy tasks_select on public.tasks for select
  using (
    public.is_active_member(tenant_id)
    and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id))
  );
create policy tasks_write on public.tasks for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('tasks.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('tasks.manage'));

grant select, insert, update, delete on
  public.pipelines, public.pipeline_stages, public.lost_reasons, public.lead_sources,
  public.leads, public.lead_contacts, public.lead_preferences, public.lead_source_events,
  public.attribution_touchpoints, public.lead_assignments, public.lead_notes, public.lead_tags,
  public.lead_stage_history, public.lead_activity_events, public.lead_duplicates,
  public.duplicate_resolution_events, public.tasks
  to authenticated;
