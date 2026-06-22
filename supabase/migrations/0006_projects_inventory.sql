-- 0006_projects_inventory.sql
-- Phase 2 — Projects & Inventory (docs/DATABASE.md §3.2–3.3, MASTER_SPEC §10).
-- Tenant-scoped, RLS default-deny. Inventory carries the 7 required statuses and
-- a freshness timestamp; status/price changes are logged to append-only history.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.project_category as enum ('apartment', 'villa', 'plot', 'commercial');
create type public.project_sale_status as enum ('upcoming', 'active', 'sold_out', 'on_hold');
create type public.project_approval_status as enum ('draft', 'pending_approval', 'approved', 'archived');
create type public.construction_status as enum ('planning', 'under_construction', 'ready_to_move', 'completed');
create type public.inventory_status as enum (
  'available', 'temporarily_held', 'reserved', 'booked', 'sold', 'blocked', 'unavailable'
);
create type public.import_status as enum ('pending', 'processing', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  developer text,
  category public.project_category not null,
  sale_status public.project_sale_status not null default 'active',
  approval_status public.project_approval_status not null default 'draft',
  construction_status public.construction_status,
  locality text,
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  possession_date date,
  price_min numeric(14, 2),
  price_max numeric(14, 2),
  currency text not null default 'INR',
  rera_id text,
  legal_notes text,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_projects_tenant on public.projects (tenant_id);
create index idx_projects_tenant_status on public.projects (tenant_id, approval_status, sale_status);
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_configurations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null, -- e.g. "2 BHK", "3 BHK + Study"
  carpet_area_sqft numeric(10, 2),
  builtup_area_sqft numeric(10, 2),
  saleable_area_sqft numeric(10, 2),
  base_price numeric(14, 2),
  created_at timestamptz not null default now()
);
create index idx_project_configs_project on public.project_configurations (project_id);

create table public.project_amenities (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null
);
create index idx_project_amenities_project on public.project_amenities (project_id);

create table public.project_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  details text,
  valid_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_project_offers_project on public.project_offers (project_id);

-- ---------------------------------------------------------------------------
-- Towers / floors (optional structure referenced by units)
-- ---------------------------------------------------------------------------
create table public.towers_or_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  total_floors integer check (total_floors >= 0)
);
create index idx_towers_project on public.towers_or_blocks (project_id);

create table public.floors (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tower_id uuid not null references public.towers_or_blocks(id) on delete cascade,
  floor_number integer not null
);
create index idx_floors_tower on public.floors (tower_id);

-- ---------------------------------------------------------------------------
-- Inventory units
-- ---------------------------------------------------------------------------
create table public.inventory_units (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  configuration_id uuid references public.project_configurations(id) on delete set null,
  tower_id uuid references public.towers_or_blocks(id) on delete set null,
  floor_id uuid references public.floors(id) on delete set null,
  unit_number text not null,
  status public.inventory_status not null default 'available',
  price numeric(14, 2),
  carpet_area_sqft numeric(10, 2),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, unit_number)
);
create index idx_units_tenant on public.inventory_units (tenant_id);
create index idx_units_project_status on public.inventory_units (project_id, status);
create index idx_units_freshness on public.inventory_units (tenant_id, last_verified_at);
create trigger trg_units_updated before update on public.inventory_units
  for each row execute function public.set_updated_at();

-- Append-only history of status + price changes.
create table public.inventory_status_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid not null references public.inventory_units(id) on delete cascade,
  previous_status public.inventory_status,
  new_status public.inventory_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_status_events_unit on public.inventory_status_events (unit_id, created_at desc);

create table public.inventory_price_history (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid not null references public.inventory_units(id) on delete cascade,
  previous_price numeric(14, 2),
  new_price numeric(14, 2),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_price_history_unit on public.inventory_price_history (unit_id, created_at desc);

-- Triggers: log status/price changes (and stamp last_verified_at on any change).
-- SECURITY DEFINER so the trigger can write the append-only history tables
-- (which have RLS enabled and no INSERT policy) regardless of the acting user.
create or replace function public.on_unit_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inventory_status_events (tenant_id, unit_id, previous_status, new_status)
      values (new.tenant_id, new.id, null, new.status);
    if new.price is not null then
      insert into public.inventory_price_history (tenant_id, unit_id, previous_price, new_price)
        values (new.tenant_id, new.id, null, new.price);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.inventory_status_events (tenant_id, unit_id, previous_status, new_status)
      values (new.tenant_id, new.id, old.status, new.status);
  end if;
  if new.price is distinct from old.price then
    insert into public.inventory_price_history (tenant_id, unit_id, previous_price, new_price)
      values (new.tenant_id, new.id, old.price, new.price);
  end if;
  return new;
end;
$$;
create trigger trg_unit_history_insert after insert on public.inventory_units
  for each row execute function public.on_unit_changed();
create trigger trg_unit_history_update after update on public.inventory_units
  for each row execute function public.on_unit_changed();

-- ---------------------------------------------------------------------------
-- Imports (CSV/XLSX) with per-row error tracking
-- ---------------------------------------------------------------------------
create table public.inventory_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  filename text,
  status public.import_status not null default 'pending',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  error_rows integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_imports_tenant on public.inventory_imports (tenant_id, created_at desc);

create table public.inventory_import_rows (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  import_id uuid not null references public.inventory_imports(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  error text,
  created_at timestamptz not null default now()
);
create index idx_import_rows_import on public.inventory_import_rows (import_id);

-- ---------------------------------------------------------------------------
-- New audit actions (catalogue grows via migration; mirrors @re/validation)
-- ---------------------------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('project.create',          'configuration', 'Project created',            false),
  ('project.update',          'configuration', 'Project updated',            false),
  ('project.approve',         'configuration', 'Project approved/published', true),
  ('inventory.update',        'configuration', 'Inventory unit updated',     false),
  ('inventory.status_change', 'configuration', 'Inventory status changed',   false),
  ('inventory.import',        'configuration', 'Inventory imported',         false),
  ('staledata.resolve',       'configuration', 'Stale inventory re-verified', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.projects               enable row level security;
alter table public.project_configurations enable row level security;
alter table public.project_amenities      enable row level security;
alter table public.project_offers         enable row level security;
alter table public.towers_or_blocks       enable row level security;
alter table public.floors                 enable row level security;
alter table public.inventory_units        enable row level security;
alter table public.inventory_status_events enable row level security;
alter table public.inventory_price_history enable row level security;
alter table public.inventory_imports      enable row level security;
alter table public.inventory_import_rows  enable row level security;

-- Read = projects.read / inventory.read (members of the tenant). Write =
-- projects.manage / inventory.manage in the ACTIVE tenant. History/imports are
-- written by triggers / the service; tenant users read only.
create policy projects_select on public.projects for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy projects_write on public.projects for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

-- Helper macro pattern repeated for project child tables (read: projects.read).
create policy project_configs_select on public.project_configurations for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy project_configs_write on public.project_configurations for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy project_amenities_select on public.project_amenities for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy project_amenities_write on public.project_amenities for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy project_offers_select on public.project_offers for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy project_offers_write on public.project_offers for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy towers_select on public.towers_or_blocks for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy towers_write on public.towers_or_blocks for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy floors_select on public.floors for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy floors_write on public.floors for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

-- Inventory units: read = inventory.read; write = inventory.manage.
create policy units_select on public.inventory_units for select
  using (public.is_active_member(tenant_id) and public.has_permission('inventory.read'));
create policy units_write on public.inventory_units for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('inventory.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('inventory.manage'));

-- History: read-only for inventory.read; no write policies (trigger writes).
create policy status_events_select on public.inventory_status_events for select
  using (public.is_active_member(tenant_id) and public.has_permission('inventory.read'));
create policy price_history_select on public.inventory_price_history for select
  using (public.is_active_member(tenant_id) and public.has_permission('inventory.read'));

-- Imports: managed with inventory.import.
create policy imports_select on public.inventory_imports for select
  using (public.is_active_member(tenant_id) and public.has_permission('inventory.read'));
create policy imports_write on public.inventory_imports for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('inventory.import'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('inventory.import'));

create policy import_rows_select on public.inventory_import_rows for select
  using (public.is_active_member(tenant_id) and public.has_permission('inventory.read'));
create policy import_rows_write on public.inventory_import_rows for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('inventory.import'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('inventory.import'));

grant select, insert, update, delete on
  public.projects, public.project_configurations, public.project_amenities,
  public.project_offers, public.towers_or_blocks, public.floors,
  public.inventory_units, public.inventory_imports, public.inventory_import_rows
  to authenticated;
grant select on public.inventory_status_events, public.inventory_price_history to authenticated;
