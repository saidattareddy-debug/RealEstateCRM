-- =====================================================================
-- Demo seed ledger — tenant-scoped, forward-only.
--
-- Records each run of the STAGING demo-data generator (scripts/demo-seed.mjs)
-- and every synthetic entity it creates, so a run is fully reversible
-- (scripts/demo-reset.mjs) and idempotent (a second seed detects the prior run
-- and skips). These are bookkeeping tables ONLY: they add NO demo-specific
-- columns to any production table and change no safety switch.
--
-- Safety: this migration grants no new operational capability. The generator
-- itself enforces the controlled-MVP safety gate before any write
-- (ALLOW_DEMO_DATA_SEED + DEPLOYMENT_PROFILE=controlled_mvp + non-production +
-- closed live-send/webhook switches + an explicit confirmation phrase). See
-- docs/DEMO_DATA.md.
--
-- RLS: default-deny. Reads require an active membership + the client-admin
-- 'demo.data.manage' permission. Writes are performed by the server
-- (service-role admin client, RLS-exempt); there is no INSERT/UPDATE/DELETE
-- policy for normal members, mirroring the scoring/matching result tables.
-- =====================================================================

create type public.demo_seed_run_status as enum (
  'running',
  'completed',
  'failed',
  'reverted'
);

-- One row per generator invocation against a tenant.
create table public.demo_seed_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_version text not null,
  run_id text not null,
  status public.demo_seed_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  correlation_id text,
  -- Idempotency anchor: a deterministic run_id is reused across re-seeds.
  unique (tenant_id, run_id)
);

create index demo_seed_runs_tenant_idx on public.demo_seed_runs (tenant_id);
-- At most ONE non-reverted run per (tenant, dataset): a second seed of the same
-- dataset finds this row and reuses/skips rather than duplicating.
create unique index demo_seed_runs_active_dataset_idx
  on public.demo_seed_runs (tenant_id, dataset_version)
  where status <> 'reverted';

-- One row per synthetic entity created by a run, for FK-safe targeted teardown.
create table public.demo_seed_entities (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.demo_seed_runs(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  external_ref text,
  created_at timestamptz not null default now(),
  unique (run_id, entity_type, entity_id)
);

create index demo_seed_entities_run_idx on public.demo_seed_entities (run_id);
create index demo_seed_entities_tenant_type_idx
  on public.demo_seed_entities (tenant_id, entity_type);

alter table public.demo_seed_runs enable row level security;
alter table public.demo_seed_entities enable row level security;
alter table public.demo_seed_runs force row level security;
alter table public.demo_seed_entities force row level security;

-- Read-only for active members holding the demo-data permission; everything
-- else (incl. INSERT/UPDATE/DELETE) is denied. Writes go through the
-- service-role admin client only.
create policy demo_seed_runs_sel on public.demo_seed_runs for select
  using (
    tenant_id = public.current_tenant_id()
    and public.is_active_member(tenant_id)
    and public.has_permission('demo.data.manage')
  );

create policy demo_seed_entities_sel on public.demo_seed_entities for select
  using (
    tenant_id = public.current_tenant_id()
    and public.is_active_member(tenant_id)
    and public.has_permission('demo.data.manage')
  );

-- ---- Permission + audit action registration --------------------------------
insert into public.permissions (key, description) values
  ('demo.data.manage', 'View controlled-MVP demo/synthetic data ledger (seed/reset/status)')
on conflict (key) do nothing;

insert into public.audit_actions (key, category, description, is_security) values
  ('demo.seed.started',           'configuration', 'Demo data seed started',           false),
  ('demo.seed.section_completed', 'configuration', 'Demo data seed section completed',  false),
  ('demo.seed.completed',         'configuration', 'Demo data seed completed',          false),
  ('demo.seed.failed',            'configuration', 'Demo data seed failed',             false),
  ('demo.reset.started',          'configuration', 'Demo data reset started',           false),
  ('demo.reset.completed',        'configuration', 'Demo data reset completed',         false),
  ('demo.reset.failed',           'configuration', 'Demo data reset failed',            false)
on conflict (key) do nothing;

-- Per-tenant grant: only the client-admin role gets read access to the ledger.
create or replace function public.grant_demo_data_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        values (r.id, 'demo.data.manage') on conflict do nothing;
    end if;
  end loop;
end $$;

-- Re-create the new-tenant provisioning trigger function so freshly created
-- tenants also receive the demo-data grant. Mirrors the prior body and appends
-- the new grant (forward-only; no behaviour removed).
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
  return new;
end; $$;

-- Apply to existing tenants.
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_demo_data_perms(t.id);
  end loop;
end $$;
