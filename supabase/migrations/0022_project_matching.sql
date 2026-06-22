-- =====================================================================
-- Phase 6B — deterministic, versioned, explainable project/config/unit matching.
-- Forward-only. Matching is ADVISORY: it never assigns a lead, changes a
-- stage/status/score, reserves inventory, or sends anything. No Phase 5B
-- delivery constraint is widened.
-- =====================================================================

-- ---- Enums -----------------------------------------------------------------
create type public.matching_rule_group as enum
  ('budget','configuration','location','property_type','area','possession',
   'amenities','lifestyle','financing','inventory','freshness','exclusions');
create type public.matching_rule_kind as enum ('hard','soft','informational','review_required');
create type public.matching_level as enum ('project','configuration','unit');
create type public.match_classification as enum
  ('excellent','good','possible','weak','ineligible','review_required','insufficient_information');
create type public.match_inventory_state as enum
  ('verified_available','available_stale','no_matching_available','availability_unknown',
   'not_available','requires_reverification');
create type public.match_budget_outcome as enum
  ('within','near','above_preferred','above_absolute','budget_unknown','price_unknown','requires_verification');
create type public.match_feedback_kind as enum
  ('accepted','rejected','interested','not_interested','wrong_budget','wrong_location',
   'wrong_configuration','inventory_unavailable','data_stale','other');
create type public.match_override_action as enum ('include','exclude','rank','classification','review');

-- ---- Models & versions -----------------------------------------------------
create table public.matching_models (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table public.matching_model_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_id uuid not null references public.matching_models(id) on delete cascade,
  version text not null,
  status public.scoring_model_status not null default 'draft',
  scale_min integer not null default 0,
  scale_max integer not null default 100 check (scale_max > scale_min),
  thresholds jsonb not null default '{"excellent":70,"good":50,"possible":30,"weak":0}',
  group_caps jsonb not null default '{}',
  group_minimums jsonb not null default '{}',
  freshness_window_days integer not null default 7 check (freshness_window_days >= 0),
  preference_signals text[] not null default '{}',
  effective_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
create unique index uniq_active_matching_version
  on public.matching_model_versions (model_id) where status = 'active';

create table public.matching_rule_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_version_id uuid not null references public.matching_model_versions(id) on delete cascade,
  group_key public.matching_rule_group not null,
  cap integer,
  minimum integer,
  ordering integer not null default 0,
  unique (model_version_id, group_key)
);

create table public.matching_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_version_id uuid not null references public.matching_model_versions(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  group_key public.matching_rule_group not null,
  kind public.matching_rule_kind not null default 'soft',
  operator text not null,
  signal_key text not null,
  candidate_field text not null,
  expected jsonb not null default '{}',
  weight numeric not null default 0,
  max_contribution numeric not null default 0,
  missing_handling text not null default 'zero' check (missing_handling in ('zero','fail','review','skip')),
  priority integer not null default 100,
  explanation_template text not null default '',
  reason text,
  effective_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- Fairness: neither the lead signal nor the candidate field may be a prohibited attribute.
  constraint matching_rule_not_prohibited
    check (not public.is_prohibited_signal(signal_key) and not public.is_prohibited_signal(candidate_field))
);
create index idx_matching_rules_version on public.matching_rules (model_version_id, priority);

-- ---- Match runs / candidates / components ----------------------------------
create table public.lead_match_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  model_version_id uuid not null references public.matching_model_versions(id) on delete restrict,
  preference_snapshot jsonb not null default '{}',
  qualification_snapshot jsonb not null default '{}',
  project_snapshot_ref text,
  inventory_snapshot_at timestamptz,
  trigger text not null default 'manual',
  calculated_at timestamptz not null default now(),
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_lead_match_runs on public.lead_match_runs (tenant_id, lead_id, calculated_at desc);

create table public.lead_match_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.lead_match_runs(id) on delete cascade,
  level public.matching_level not null,
  project_id uuid references public.projects(id) on delete set null,
  project_configuration_id uuid references public.project_configurations(id) on delete set null,
  inventory_unit_id uuid references public.inventory_units(id) on delete set null,
  eligible boolean not null default false,
  score integer not null default 0,
  classification public.match_classification not null,
  confidence numeric not null default 0,
  preference_completeness numeric not null default 0,
  inventory_state public.match_inventory_state not null default 'availability_unknown',
  unit_confirmed boolean not null default false,
  budget_outcome public.match_budget_outcome not null default 'budget_unknown',
  rank integer not null default 0,
  hard_failures text[] not null default '{}'
);
create index idx_lead_match_candidates on public.lead_match_candidates (run_id, rank);

create table public.lead_match_components (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid not null references public.lead_match_candidates(id) on delete cascade,
  rule_id uuid,
  group_key public.matching_rule_group,
  kind public.matching_rule_kind,
  signal_key text not null,
  contribution numeric not null default 0,
  applied boolean not null default false,
  positive boolean not null default false,
  skipped_reason text,
  explanation text
);
create index idx_lead_match_components on public.lead_match_components (candidate_id);

create table public.lead_match_inventory_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.lead_match_runs(id) on delete cascade,
  inventory_unit_id uuid references public.inventory_units(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  status text,
  verified_at timestamptz,
  captured_at timestamptz not null default now()
);

create table public.lead_match_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  run_id uuid references public.lead_match_runs(id) on delete set null,
  candidate_id uuid references public.lead_match_candidates(id) on delete set null,
  action public.match_override_action not null,
  rank integer,
  classification public.match_classification,
  reason text not null,
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  applied_at timestamptz not null default now(),
  expires_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_lead_match_overrides on public.lead_match_overrides (tenant_id, lead_id, applied_at desc);

create table public.lead_match_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.lead_match_runs(id) on delete set null,
  candidate_id uuid references public.lead_match_candidates(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind public.match_feedback_kind not null,
  reason text,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---- Evaluation ------------------------------------------------------------
create table public.matching_evaluation_datasets (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.matching_evaluation_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.matching_evaluation_datasets(id) on delete cascade,
  name text not null,
  lead_snapshot jsonb not null default '{}',
  candidates jsonb not null default '[]',
  inventory_snapshot jsonb not null default '[]',
  expected_eligibility jsonb not null default '{}',
  expected_ranking jsonb not null default '[]',
  expected_min integer,
  expected_max integer,
  expected_classification public.match_classification,
  expected_inventory_state public.match_inventory_state,
  forbidden_outcomes text[] not null default '{}'
);
create table public.matching_evaluation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.matching_evaluation_datasets(id) on delete cascade,
  model_version_id uuid not null references public.matching_model_versions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.matching_evaluation_results (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.matching_evaluation_runs(id) on delete cascade,
  case_id uuid not null references public.matching_evaluation_cases(id) on delete cascade,
  passed boolean not null,
  detail jsonb
);

-- ---- Active-version immutability -------------------------------------------
create or replace function public.matching_active_version_immutable()
returns trigger language plpgsql as $$
declare v_status public.scoring_model_status;
begin
  select status into v_status from public.matching_model_versions
    where id = coalesce(new.model_version_id, old.model_version_id);
  if v_status = 'active' then
    raise exception 'active_matching_version_is_immutable';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_matching_rules_immutable
  before insert or update or delete on public.matching_rules
  for each row execute function public.matching_active_version_immutable();

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key) values
  ('matching.read'), ('matching.run'), ('matching.override'), ('matching.feedback.create'),
  ('matching.models.read'), ('matching.models.manage'), ('matching.models.approve'),
  ('matching.evaluation.use')
on conflict (key) do nothing;

-- ---- RLS -------------------------------------------------------------------
alter table public.matching_models enable row level security;
alter table public.matching_model_versions enable row level security;
alter table public.matching_rule_groups enable row level security;
alter table public.matching_rules enable row level security;
alter table public.lead_match_runs enable row level security;
alter table public.lead_match_candidates enable row level security;
alter table public.lead_match_components enable row level security;
alter table public.lead_match_inventory_snapshots enable row level security;
alter table public.lead_match_overrides enable row level security;
alter table public.lead_match_feedback enable row level security;
alter table public.matching_evaluation_datasets enable row level security;
alter table public.matching_evaluation_cases enable row level security;
alter table public.matching_evaluation_runs enable row level security;
alter table public.matching_evaluation_results enable row level security;

-- Model-config tables: read matching.models.read; write matching.models.manage.
do $$
declare t text;
begin
  for t in select unnest(array[
    'matching_models','matching_model_versions','matching_rule_groups','matching_rules',
    'matching_evaluation_datasets','matching_evaluation_cases','matching_evaluation_runs',
    'matching_evaluation_results'
  ]) loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('matching.models.read'));
      create policy %1$s_ins on public.%1$s for insert
        with check (tenant_id = public.current_tenant_id() and public.has_permission('matching.models.manage'));
      create policy %1$s_upd on public.%1$s for update
        using (tenant_id = public.current_tenant_id() and public.has_permission('matching.models.manage'));
    $f$, t);
  end loop;
end $$;

-- Lead-scoped match data: read matching.read (writes by the server service role).
do $$
declare t text;
begin
  for t in select unnest(array[
    'lead_match_runs','lead_match_candidates','lead_match_components','lead_match_inventory_snapshots'
  ]) loop
    execute format($f$
      create policy %1$s_sel on public.%1$s for select
        using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
          and public.has_permission('matching.read'));
    $f$, t);
  end loop;
end $$;

create policy lmo_sel on public.lead_match_overrides for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('matching.read'));
create policy lmo_ins on public.lead_match_overrides for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('matching.override'));
create policy lmo_upd on public.lead_match_overrides for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('matching.override'));
create policy lmf_sel on public.lead_match_feedback for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('matching.read'));
create policy lmf_ins on public.lead_match_feedback for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('matching.feedback.create'));

-- ---- Audit actions ---------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('matching.model.created', 'configuration', 'Matching model created', false),
  ('matching.version.created', 'configuration', 'Matching model version created', false),
  ('matching.model.submitted', 'configuration', 'Matching model submitted for approval', false),
  ('matching.model.approved', 'configuration', 'Matching model approved', true),
  ('matching.model.activated', 'configuration', 'Matching model version activated', true),
  ('matching.model.retired', 'configuration', 'Matching model version retired', false),
  ('matching.calculated', 'configuration', 'Lead match calculated', false),
  ('matching.recalculated', 'configuration', 'Lead match recalculated', false),
  ('matching.candidate.excluded', 'configuration', 'Match candidate excluded', false),
  ('matching.inventory.stale', 'configuration', 'Match inventory marked stale', false),
  ('matching.override.applied', 'configuration', 'Match override applied', true),
  ('matching.override.removed', 'configuration', 'Match override removed', true),
  ('matching.feedback.recorded', 'configuration', 'Match feedback recorded', false),
  ('matching.extraction.proposed', 'configuration', 'AI preference extraction proposed', false),
  ('matching.extraction.approved', 'configuration', 'AI preference extraction approved', false),
  ('matching.extraction.rejected', 'configuration', 'AI preference extraction rejected', false)
on conflict (key) do nothing;

-- ---- Per-tenant grants + synthetic seed ------------------------------------
create or replace function public.grant_phase6b_matching_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'matching.read','matching.run','matching.override','matching.feedback.create',
          'matching.models.read','matching.models.manage','matching.models.approve','matching.evaluation.use'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'matching.read','matching.run','matching.override','matching.feedback.create',
          'matching.models.read','matching.evaluation.use'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['matching.read','matching.feedback.create']) k on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.seed_phase6b_matching(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_model uuid; v_version uuid;
begin
  if exists (select 1 from public.matching_models where tenant_id = p_tenant and key = 'default') then
    return;
  end if;
  insert into public.matching_models (tenant_id, key, name, description)
    values (p_tenant, 'default', 'Default project match', 'Synthetic starter matching model')
    returning id into v_model;
  insert into public.matching_model_versions (tenant_id, model_id, version, status, preference_signals, freshness_window_days)
    values (p_tenant, v_model, 'v1', 'draft', array['budget','locality','configuration'], 7)
    returning id into v_version;
  insert into public.matching_rules
    (tenant_id, model_version_id, group_key, kind, operator, signal_key, candidate_field, weight, max_contribution, priority, explanation_template)
  values
    (p_tenant, v_version, 'budget', 'soft', 'budget_overlap', 'budget', 'price', 40, 40, 5, 'Budget overlaps'),
    (p_tenant, v_version, 'location', 'soft', 'enum_in', 'locality', 'locality', 30, 30, 10, 'Preferred locality'),
    (p_tenant, v_version, 'exclusions', 'hard', 'exclusion', 'excludedLocalities', 'locality', 0, 0, 1, 'Excluded location'),
    (p_tenant, v_version, 'amenities', 'soft', 'set_intersection', 'amenities', 'amenities', 20, 20, 20, 'Amenity match');
  update public.matching_model_versions set status = 'active', activated_at = now() where id = v_version;
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
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase6b_matching_perms(t.id);
    perform public.seed_phase6b_matching(t.id);
  end loop;
end $$;
