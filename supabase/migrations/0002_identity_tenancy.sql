-- 0002_identity_tenancy.sql
-- Tenant & identity domain (docs/DATABASE.md §3.1). Every tenant-owned table
-- carries tenant_id. Roles are tenant-scoped so tenants can customize them;
-- the permission catalog is global. RLS is enabled in 0004.

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  plan_tier text not null default 'starter' check (plan_tier in ('starter','growth','enterprise')),
  deployment_mode text not null default 'shared' check (deployment_mode in ('shared','dedicated')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tenants_updated before update on public.tenants
  for each row execute function public.set_updated_at();

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  logo_url text,
  favicon_url text,
  primary_color text not null default '#274D3D' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#18372B' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text not null default '#B79257' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  login_image_url text,
  custom_domain text unique,
  terminology jsonb not null default '{}'::jsonb,
  white_label boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_branding_updated before update on public.tenant_branding
  for each row execute function public.set_updated_at();

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  locale text not null default 'en',
  default_language text not null default 'en',
  enabled_languages text[] not null default array['en','hi','kn','ta','te','hi-en'],
  escalation_confidence numeric(3,2) not null default 0.75 check (escalation_confidence between 0 and 1),
  inventory_freshness_hours integer not null default 24 check (inventory_freshness_hours > 0),
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '09:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_settings_updated before update on public.tenant_settings
  for each row execute function public.set_updated_at();

create table public.tenant_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  primary key (tenant_id, feature_key)
);

-- ---------------------------------------------------------------------------
-- Profiles & platform admins
-- ---------------------------------------------------------------------------
-- profiles.id mirrors auth.users.id (1:1). is_platform_admin gates platform
-- scope; it does NOT grant silent tenant-data access (docs/SECURITY.md §5).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Permissions catalog (global) & tenant-scoped roles
-- ---------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  description text
);

create table public.roles (
  id uuid primary key default extensions.gen_random_uuid(),
  -- tenant_id null => platform role template (e.g. super_admin)
  tenant_id uuid references public.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- Memberships & per-user permission overrides
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status text not null default 'active' check (status in ('active','suspended','invited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, profile_id)
);
create trigger trg_memberships_updated before update on public.memberships
  for each row execute function public.set_updated_at();
create index idx_memberships_profile on public.memberships(profile_id);
create index idx_memberships_tenant on public.memberships(tenant_id);

create table public.user_permissions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  effect text not null check (effect in ('grant','revoke')),
  unique (tenant_id, profile_id, permission_key)
);
create index idx_user_permissions_lookup on public.user_permissions(tenant_id, profile_id);

create table public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email extensions.citext not null,
  role_id uuid not null references public.roles(id),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
create index idx_invitations_tenant on public.invitations(tenant_id);
