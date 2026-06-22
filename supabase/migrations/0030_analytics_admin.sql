-- 0030_analytics_admin.sql
-- Phase 9 — Analytics & Administration (forward-only).
--
-- Usage/billing counters, a system-health snapshot table, and a logged-export
-- ledger. Dashboards/funnel/source/team metrics are computed on the fly from the
-- existing RLS-scoped tables (leads/pipeline/conversations/visits) via the pure
-- `@re/domain` analytics reducers, so they need no new storage. All tables here
-- are tenant-scoped with default-deny RLS.

-- ===========================================================================
-- 1. Usage counters (metered usage per billing period)
-- ===========================================================================
create table public.usage_counters (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric text not null,
  period_start date not null,
  period_end date not null,
  used numeric not null default 0 check (used >= 0),
  recorded_at timestamptz not null default now(),
  unique (tenant_id, metric, period_start)
);
create index idx_usage_counters_tenant on public.usage_counters (tenant_id, metric, period_start);

-- ===========================================================================
-- 2. Billing periods (plan + window + status; no payment instruments stored)
-- ===========================================================================
create table public.billing_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  plan_tier text not null default 'starter' check (plan_tier in ('starter','growth','enterprise')),
  status text not null default 'open' check (status in ('open','closed','invoiced')),
  currency text not null default 'INR',
  amount_due numeric not null default 0 check (amount_due >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);

-- ===========================================================================
-- 3. System / integration health snapshots
-- ===========================================================================
create table public.system_health_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  -- NULL tenant = platform-scope check (visible only to platform admins).
  tenant_id uuid references public.tenants(id) on delete cascade,
  component text not null,
  state text not null check (state in ('healthy','degraded','down','unknown')),
  latency_ms integer,
  detail text,
  checked_at timestamptz not null default now()
);
create index idx_system_health_tenant on public.system_health_checks (tenant_id, component, checked_at desc);

-- ===========================================================================
-- 4. Logged exports (data-egress ledger for analytics/report exports)
-- ===========================================================================
create table public.analytics_export_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  report text not null,
  format text not null check (format in ('csv','json')),
  row_count integer not null default 0,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_analytics_export_tenant on public.analytics_export_logs (tenant_id, created_at desc);

-- ===========================================================================
-- 5. Permissions (most analytics.*/billing.* already exist; add 2 new)
-- ===========================================================================
insert into public.permissions (key) values
  ('system.health.read'), ('analytics.export')
on conflict (key) do nothing;

-- ===========================================================================
-- 6. RLS
-- ===========================================================================
alter table public.usage_counters enable row level security;
alter table public.billing_periods enable row level security;
alter table public.system_health_checks enable row level security;
alter table public.analytics_export_logs enable row level security;

create policy uc_sel on public.usage_counters for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and (public.has_permission('billing.read') or public.has_permission('analytics.cost.read')));

create policy bp_sel on public.billing_periods for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('billing.read'));
create policy bp_ins on public.billing_periods for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('billing.manage'));
create policy bp_upd on public.billing_periods for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('billing.manage'));

-- Tenant-scope health rows visible to permitted members; platform rows only to
-- platform admins.
create policy shc_sel on public.system_health_checks for select
  using (
    (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
      and public.has_permission('system.health.read'))
    or (tenant_id is null and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin))
  );

create policy ael_sel on public.analytics_export_logs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('settings.audit.read'));
create policy ael_ins on public.analytics_export_logs for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('analytics.export'));

-- ===========================================================================
-- 7. Audit actions
-- ===========================================================================
insert into public.audit_actions (key, category, description, is_security) values
  ('usage.recorded', 'configuration', 'Usage counter recorded', false),
  ('billing.period.updated', 'configuration', 'Billing period updated', true),
  ('analytics.exported', 'data_export', 'Analytics/report exported', true),
  ('system.health.recorded', 'configuration', 'System health snapshot recorded', false)
on conflict (key) do nothing;

-- ===========================================================================
-- 8. Per-tenant grants + provisioning (only the 2 NEW keys; analytics.*/billing.*
-- are already granted by the base bundles in migration 0014)
-- ===========================================================================
create or replace function public.grant_phase9_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['system.health.read','analytics.export']) k
        on conflict do nothing;
    elsif r.slug in ('sales_manager','marketing_manager') then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['analytics.export']) k on conflict do nothing;
    end if;
  end loop;
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
  perform public.grant_demo_data_perms(new.id);
  perform public.grant_phase8_perms(new.id);
  perform public.grant_phase9_perms(new.id);
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase9_perms(t.id);
  end loop;
end $$;
