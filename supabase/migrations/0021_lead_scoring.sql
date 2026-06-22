-- =====================================================================
-- Phase 6A — deterministic, versioned, explainable lead scoring.
-- Forward-only. Scoring is ADVISORY: nothing here changes a lead's stage,
-- assignment, status, conversation mode, or triggers any communication. No
-- Phase 5B delivery constraint is widened.
-- =====================================================================

-- ---- Enums -----------------------------------------------------------------
create type public.scoring_model_status as enum ('draft', 'pending_approval', 'active', 'retired');
create type public.scoring_classification as enum
  ('hot', 'warm', 'cold', 'disqualified', 'unscored', 'review_required');
create type public.scoring_rule_group as enum
  ('intent', 'fit', 'engagement', 'source', 'freshness', 'qualification', 'negative', 'disqualification');
create type public.scoring_signal_category as enum
  ('intent', 'fit', 'engagement', 'source', 'freshness', 'negative', 'qualification');
create type public.scoring_signal_state as enum
  ('known', 'unknown', 'not_applicable', 'contradictory', 'stale', 'unverified');

-- Prohibited (protected/sensitive) signal keys — can never be scoring inputs.
-- Mirrors PROHIBITED_SIGNAL_KEYS in packages/domain/src/scoring.ts.
create or replace function public.is_prohibited_signal(p_key text)
returns boolean language sql immutable as $$
  select p_key = any (array[
    'race','ethnicity','religion','caste','political_affiliation','sexual_orientation',
    'disability','medical_status','gender','family_status','socioeconomic_profile',
    'accent','name_demographic','neighbourhood_demographic'
  ]);
$$;

-- ---- Models & versions -----------------------------------------------------
create table public.scoring_models (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table public.scoring_model_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_id uuid not null references public.scoring_models(id) on delete cascade,
  version text not null,
  status public.scoring_model_status not null default 'draft',
  scale_min integer not null default 0,
  scale_max integer not null default 100 check (scale_max > scale_min),
  thresholds jsonb not null default '{"hot":70,"warm":40,"cold":0,"review":0}',
  group_caps jsonb not null default '{}',
  group_minimums jsonb not null default '{}',
  total_min integer,
  total_max integer,
  qualification_signals text[] not null default '{}',
  effective_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
-- At most one ACTIVE version per model.
create unique index uniq_active_model_version
  on public.scoring_model_versions (model_id) where status = 'active';

create table public.scoring_rule_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_version_id uuid not null references public.scoring_model_versions(id) on delete cascade,
  group_key public.scoring_rule_group not null,
  cap integer,
  minimum integer,
  ordering integer not null default 0,
  unique (model_version_id, group_key)
);

create table public.scoring_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_version_id uuid not null references public.scoring_model_versions(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  group_key public.scoring_rule_group not null,
  signal_key text not null,
  operator text not null,
  expected jsonb not null default '{}',
  weight numeric not null default 0,
  max_contribution numeric not null default 0,
  min_contribution numeric not null default 0,
  required_evidence boolean not null default false,
  effective_at timestamptz,
  expires_at timestamptz,
  priority integer not null default 100,
  stop_processing boolean not null default false,
  explanation_template text not null default '',
  unknown_handling text not null default 'zero' check (unknown_handling in ('zero','review','skip')),
  reason text,
  created_at timestamptz not null default now(),
  -- Fairness: a rule can never target a prohibited signal.
  constraint scoring_rule_not_prohibited check (not public.is_prohibited_signal(signal_key))
);
create index idx_scoring_rules_version on public.scoring_rules (model_version_id, priority);

create table public.scoring_signal_definitions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  signal_key text not null,
  category public.scoring_signal_category not null,
  value_type text not null default 'boolean',
  description text,
  created_at timestamptz not null default now(),
  unique (tenant_id, signal_key),
  -- Fairness: a prohibited signal can never be defined as a scoring input.
  constraint scoring_signal_not_prohibited check (not public.is_prohibited_signal(signal_key))
);

-- ---- Observations ----------------------------------------------------------
create table public.lead_signal_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  signal_key text not null,
  value jsonb,
  value_type text not null default 'boolean',
  state public.scoring_signal_state not null default 'known',
  source_type text not null default 'system',
  source_record_id uuid,
  observed_at timestamptz not null default now(),
  verification_state text not null default 'unverified',
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  expires_at timestamptz,
  superseded_at timestamptz,
  correlation_id text,
  created_at timestamptz not null default now(),
  constraint observation_not_prohibited check (not public.is_prohibited_signal(signal_key))
);
create index idx_lead_observations on public.lead_signal_observations (tenant_id, lead_id, signal_key);

-- ---- Score runs / components / history -------------------------------------
create table public.lead_score_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- The exact model version used is recorded and never null.
  model_version_id uuid not null references public.scoring_model_versions(id) on delete restrict,
  score integer not null,
  classification public.scoring_classification not null,
  evidence_completeness numeric not null default 0,
  calculation_confidence numeric not null default 0,
  qualification_complete boolean not null default false,
  disqualified boolean not null default false,
  disqualification_reason text,
  review_required boolean not null default false,
  review_reason text,
  trigger text not null default 'manual',
  calculated_at timestamptz not null default now(),
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_lead_score_runs on public.lead_score_runs (tenant_id, lead_id, calculated_at desc);

create table public.lead_score_components (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.lead_score_runs(id) on delete cascade,
  rule_id uuid,
  group_key public.scoring_rule_group,
  signal_key text not null,
  contribution numeric not null default 0,
  applied boolean not null default false,
  skipped_reason text,
  explanation text
);
create index idx_lead_score_components on public.lead_score_components (run_id);

create table public.lead_score_history (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  run_id uuid references public.lead_score_runs(id) on delete set null,
  previous_score integer,
  new_score integer,
  previous_classification public.scoring_classification,
  new_classification public.scoring_classification,
  trigger text,
  model_version text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_lead_score_history on public.lead_score_history (tenant_id, lead_id, created_at desc);

create table public.lead_score_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  score integer,
  classification public.scoring_classification,
  disqualify_cleared boolean not null default false,
  review_cleared boolean not null default false,
  reason text not null,
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  applied_at timestamptz not null default now(),
  expires_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_lead_score_overrides on public.lead_score_overrides (tenant_id, lead_id, applied_at desc);

-- ---- Evaluation ------------------------------------------------------------
create table public.scoring_evaluation_datasets (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.scoring_evaluation_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.scoring_evaluation_datasets(id) on delete cascade,
  name text not null,
  observations jsonb not null default '[]',
  expected_classification public.scoring_classification,
  expected_min integer,
  expected_max integer,
  expected_missing text[] not null default '{}',
  expected_disqualified boolean not null default false,
  expected_review boolean not null default false,
  forbidden_inputs text[] not null default '{}'
);
create table public.scoring_evaluation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.scoring_evaluation_datasets(id) on delete cascade,
  model_version_id uuid not null references public.scoring_model_versions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.scoring_evaluation_results (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.scoring_evaluation_runs(id) on delete cascade,
  case_id uuid not null references public.scoring_evaluation_cases(id) on delete cascade,
  passed boolean not null,
  actual_classification public.scoring_classification,
  actual_score integer,
  detail jsonb
);

-- ---- Active-version immutability -------------------------------------------
-- Rules belonging to an ACTIVE model version cannot be inserted/updated/deleted;
-- a new version must be drafted instead.
create or replace function public.scoring_active_version_immutable()
returns trigger language plpgsql as $$
declare v_status public.scoring_model_status;
begin
  select status into v_status from public.scoring_model_versions
    where id = coalesce(new.model_version_id, old.model_version_id);
  if v_status = 'active' then
    raise exception 'active_model_version_is_immutable';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_scoring_rules_immutable
  before insert or update or delete on public.scoring_rules
  for each row execute function public.scoring_active_version_immutable();

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key) values
  ('scoring.read'), ('scoring.run'), ('scoring.override'),
  ('scoring.models.read'), ('scoring.models.manage'), ('scoring.models.approve'),
  ('scoring.signals.manage'), ('scoring.evaluation.use')
on conflict (key) do nothing;

-- ---- RLS -------------------------------------------------------------------
alter table public.scoring_models enable row level security;
alter table public.scoring_model_versions enable row level security;
alter table public.scoring_rule_groups enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.scoring_signal_definitions enable row level security;
alter table public.lead_signal_observations enable row level security;
alter table public.lead_score_runs enable row level security;
alter table public.lead_score_components enable row level security;
alter table public.lead_score_history enable row level security;
alter table public.lead_score_overrides enable row level security;
alter table public.scoring_evaluation_datasets enable row level security;
alter table public.scoring_evaluation_cases enable row level security;
alter table public.scoring_evaluation_runs enable row level security;
alter table public.scoring_evaluation_results enable row level security;

-- Model configuration: read with scoring.models.read; write with .manage.
do $$
declare t text;
begin
  for t in select unnest(array[
    'scoring_models','scoring_model_versions','scoring_rule_groups','scoring_rules',
    'scoring_signal_definitions','scoring_evaluation_datasets','scoring_evaluation_cases',
    'scoring_evaluation_runs','scoring_evaluation_results'
  ]) loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('scoring.models.read'));
      create policy %1$s_ins on public.%1$s for insert
        with check (tenant_id = public.current_tenant_id()
          and public.has_permission('scoring.models.manage'));
      create policy %1$s_upd on public.%1$s for update
        using (tenant_id = public.current_tenant_id()
          and public.has_permission('scoring.models.manage'));
    $f$, t);
  end loop;
end $$;

-- Lead-scoped scoring data: read with scoring.read; observations/runs written by
-- the server (service role, RLS-exempt). Overrides require scoring.override.
create policy lso_sel on public.lead_signal_observations for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('scoring.read'));
create policy lsr_sel on public.lead_score_runs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('scoring.read'));
create policy lsc_sel on public.lead_score_components for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('scoring.read'));
create policy lsh_sel on public.lead_score_history for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('scoring.read'));
create policy lsov_sel on public.lead_score_overrides for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('scoring.read'));
create policy lsov_ins on public.lead_score_overrides for insert
  with check (tenant_id = public.current_tenant_id()
    and public.has_permission('scoring.override'));
create policy lsov_upd on public.lead_score_overrides for update
  using (tenant_id = public.current_tenant_id()
    and public.has_permission('scoring.override'));

-- ---- Audit actions ---------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('scoring.model.created', 'configuration', 'Scoring model created', false),
  ('scoring.model_version.created', 'configuration', 'Scoring model version created', false),
  ('scoring.model.submitted', 'configuration', 'Scoring model submitted for approval', false),
  ('scoring.model.approved', 'configuration', 'Scoring model approved', true),
  ('scoring.model.activated', 'configuration', 'Scoring model version activated', true),
  ('scoring.model.retired', 'configuration', 'Scoring model version retired', false),
  ('scoring.signal.created', 'configuration', 'Scoring signal definition created', false),
  ('scoring.observation.recorded', 'configuration', 'Lead signal observation recorded', false),
  ('scoring.calculated', 'configuration', 'Lead score calculated', false),
  ('scoring.recalculated', 'configuration', 'Lead score recalculated', false),
  ('scoring.override.applied', 'configuration', 'Lead score override applied', true),
  ('scoring.override.removed', 'configuration', 'Lead score override removed', true),
  ('scoring.disqualification.recommended', 'configuration', 'Lead disqualification recommended', false),
  ('scoring.review.required', 'configuration', 'Lead review required', false),
  ('scoring.extraction.proposed', 'configuration', 'AI signal extraction proposed', false),
  ('scoring.extraction.approved', 'configuration', 'AI signal extraction approved', false),
  ('scoring.extraction.rejected', 'configuration', 'AI signal extraction rejected', false)
on conflict (key) do nothing;

-- ---- Per-tenant grants + synthetic seed (forward-only) ---------------------
create or replace function public.grant_phase6a_scoring_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'scoring.read','scoring.run','scoring.override','scoring.models.read',
          'scoring.models.manage','scoring.models.approve','scoring.signals.manage',
          'scoring.evaluation.use'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'scoring.read','scoring.run','scoring.override','scoring.models.read','scoring.evaluation.use'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      insert into public.role_permissions (role_id, permission_key)
        values (r.id, 'scoring.read') on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.seed_phase6a_scoring(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_model uuid; v_version uuid;
begin
  if exists (select 1 from public.scoring_models where tenant_id = p_tenant and key = 'default') then
    return;
  end if;
  insert into public.scoring_models (tenant_id, key, name, description)
    values (p_tenant, 'default', 'Default lead score', 'Synthetic starter model')
    returning id into v_model;
  -- Seed as DRAFT so the immutability trigger permits rule inserts, then activate.
  insert into public.scoring_model_versions (tenant_id, model_id, version, status, qualification_signals)
    values (p_tenant, v_model, 'v1', 'draft', array['budget'])
    returning id into v_version;
  insert into public.scoring_rules
    (tenant_id, model_version_id, group_key, signal_key, operator, weight, max_contribution, priority, explanation_template, required_evidence)
  values
    (p_tenant, v_version, 'intent', 'booking_intent', 'boolean_true', 60, 60, 1, 'Explicit booking interest', false),
    (p_tenant, v_version, 'intent', 'site_visit_request', 'boolean_true', 25, 25, 2, 'Site-visit request', false),
    (p_tenant, v_version, 'qualification', 'budget', 'numeric_range', 0, 0, 3, 'Budget known', true),
    (p_tenant, v_version, 'disqualification', 'spam', 'disqualify', 0, 0, 0, 'Spam or test enquiry', false);
  update public.scoring_model_versions set status = 'active', activated_at = now() where id = v_version;
  insert into public.scoring_signal_definitions (tenant_id, signal_key, category, value_type) values
    (p_tenant, 'booking_intent', 'intent', 'boolean'),
    (p_tenant, 'site_visit_request', 'intent', 'boolean'),
    (p_tenant, 'budget', 'fit', 'number'),
    (p_tenant, 'spam', 'negative', 'boolean')
  on conflict do nothing;
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
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase6a_scoring_perms(t.id);
    perform public.seed_phase6a_scoring(t.id);
  end loop;
end $$;
