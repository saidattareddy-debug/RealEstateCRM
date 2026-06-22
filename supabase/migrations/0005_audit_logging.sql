-- 0005_audit_logging.sql
-- Phase 1.1 — application audit logging + security events.
-- Append-only audit trail for tenant users; tenant admins may READ (with
-- settings.audit.read) but never edit/delete. Writes happen server-side via the
-- service-role audit service (bypasses RLS); there are intentionally NO
-- INSERT/UPDATE/DELETE policies for tenant users on audit_logs.
-- See docs/AUDIT_LOGGING.md and docs/SECURITY.md.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.audit_event_category as enum (
  'auth', 'tenant', 'access_control', 'configuration',
  'data_export', 'integration', 'impersonation', 'abuse'
);
create type public.security_event_severity as enum ('info', 'low', 'medium', 'high', 'critical');
create type public.security_event_status as enum ('open', 'investigating', 'resolved', 'ignored');

-- ---------------------------------------------------------------------------
-- Typed action catalogue (mirrors packages/validation/src/audit.ts).
-- audit_logs.action is FK-constrained to this table, so arbitrary action
-- strings cannot be written.
-- ---------------------------------------------------------------------------
create table public.audit_actions (
  key text primary key,
  category public.audit_event_category not null,
  description text not null,
  is_security boolean not null default false
);

insert into public.audit_actions (key, category, description, is_security) values
  ('auth.sign_in.success',        'auth',           'User signed in',                          false),
  ('auth.sign_in.failure',        'auth',           'Failed sign-in attempt',                  true),
  ('auth.sign_out',               'auth',           'User signed out',                         false),
  ('tenant.switch',               'tenant',         'Active tenant switched',                  false),
  ('tenant.switch.denied',        'access_control', 'Tenant switch denied (not a member)',     true),
  ('invitation.create',           'access_control', 'Invitation created',                      false),
  ('invitation.accept',           'access_control', 'Invitation accepted',                     false),
  ('membership.role_change',      'access_control', 'Member role changed',                     true),
  ('permission.override',         'access_control', 'Per-user permission grant/revoke',        true),
  ('settings.branding.update',    'configuration',  'Branding updated',                        false),
  ('settings.org.update',         'configuration',  'Organisation settings updated',           false),
  ('impersonation.start',         'impersonation',  'Support impersonation started',           true),
  ('impersonation.end',           'impersonation',  'Support impersonation ended',             true),
  ('data.export.request',         'data_export',    'Data export requested',                   true),
  ('integration.config.change',   'integration',    'Integration/secret configuration changed', true);

-- ---------------------------------------------------------------------------
-- audit_logs (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,   -- null = platform-scope
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  actor_role text,
  action text not null references public.audit_actions(key),
  entity_type text,
  entity_id text,
  previous_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  request_id text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_tenant_time on public.audit_logs (tenant_id, created_at desc);
create index idx_audit_logs_action on public.audit_logs (action);
create index idx_audit_logs_actor on public.audit_logs (actor_user_id);
create index idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index idx_audit_logs_correlation on public.audit_logs (correlation_id);

-- ---------------------------------------------------------------------------
-- security_events (deduplicated, resolvable)
-- ---------------------------------------------------------------------------
create table public.security_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,   -- null = platform-scope
  action text references public.audit_actions(key),
  category public.audit_event_category not null,
  severity public.security_event_severity not null default 'medium',
  status public.security_event_status not null default 'open',
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_notes text,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  created_at timestamptz not null default now()
);
create index idx_sec_events_tenant_status on public.security_events (tenant_id, status, severity);
create index idx_sec_events_category on public.security_events (category);
create index idx_sec_events_dedupe on public.security_events (tenant_id, action, entity_type, entity_id, status);

-- ---------------------------------------------------------------------------
-- Data-retention configuration (per tenant)
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column audit_retention_days integer not null default 365 check (audit_retention_days > 0);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.audit_actions    enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.security_events  enable row level security;

-- Catalogue: readable by any authenticated user (static reference).
create policy audit_actions_select on public.audit_actions for select
  using (auth.role() = 'authenticated');

-- audit_logs: READ ONLY for tenant users with settings.audit.read in their
-- active tenant. Platform admin sees ONLY platform-scope rows (tenant_id null)
-- — no silent tenant-audit access; tenant audit is reached via the audited
-- impersonation model (docs/SECURITY.md §5, docs/AUDIT_LOGGING.md). No write
-- policies => append-only & immutable for tenant users (service role writes).
create policy audit_logs_select on public.audit_logs for select
  using (
    (tenant_id is not null
       and tenant_id = public.current_tenant_id()
       and public.has_permission('settings.audit.read'))
    or (tenant_id is null and public.is_platform_admin())
  );

-- security_events: READ with settings.security.manage in active tenant; platform
-- admin sees only platform-scope rows. UPDATE only resolution fields (enforced
-- in the service) with the same permission; never deleted.
create policy sec_events_select on public.security_events for select
  using (
    (tenant_id is not null
       and tenant_id = public.current_tenant_id()
       and public.has_permission('settings.security.manage'))
    or (tenant_id is null and public.is_platform_admin())
  );
create policy sec_events_update on public.security_events for update
  using (
    tenant_id = public.current_tenant_id()
      and public.has_permission('settings.security.manage')
  )
  with check (
    tenant_id = public.current_tenant_id()
      and public.has_permission('settings.security.manage')
  );

-- Grants (RLS still restricts rows). Service role bypasses RLS for writes.
grant select on public.audit_actions, public.audit_logs, public.security_events to authenticated;
grant update on public.security_events to authenticated;
