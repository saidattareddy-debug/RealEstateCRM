-- 0004_roles_seed_and_rls.sql
-- (1) Default-role seeding on tenant creation. (2) RLS: default-deny + policies
-- on every tenant-owned table (docs/SECURITY.md §3). Bundles mirror
-- packages/validation/permissions.ts and docs/PERMISSIONS_MATRIX.md.

-- ---------------------------------------------------------------------------
-- (1) Seed default tenant roles + their permission bundles.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid;
begin
  -- client_admin
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'client_admin', 'Client Admin', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key)
    select v_role, key from public.permissions
    where key like 'settings.%' or key like 'users.%' or key like 'agents.%'
       or key in ('team.performance.read')
       or key like 'projects.%' or key like 'inventory.%' or key like 'knowledge.%'
       or key in ('staledata.resolve')
       or key in ('leads.read.all','leads.create','leads.update','leads.assign',
                  'leads.reassign','leads.merge','leads.export','leads.classify.override')
       or key like 'conversations.%'
       or key in ('pipeline.configure','pipeline.move','tasks.manage','calls.manage',
                  'sitevisits.read','sitevisits.manage')
       or key in ('scoring.read','scoring.edit','scoring.approve','scoring.publish',
                  'automations.manage','assignment.configure')
       or key in ('campaigns.manage','sources.manage','forms.manage','attribution.read')
       or key like 'analytics.%'
       or key in ('billing.read','billing.manage')
    on conflict do nothing;

  -- marketing_manager
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'marketing_manager', 'Marketing Manager', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'campaigns.manage'),(v_role,'sources.manage'),(v_role,'forms.manage'),
    (v_role,'attribution.read'),(v_role,'analytics.marketing.read'),(v_role,'leads.create'),
    (v_role,'leads.read.team'),(v_role,'scoring.read'),(v_role,'scoring.edit'),
    (v_role,'automations.manage'),(v_role,'projects.read'),(v_role,'inventory.read')
    on conflict do nothing;

  -- sales_manager
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'sales_manager', 'Sales Manager', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'team.performance.read'),(v_role,'agents.manage'),(v_role,'agents.availability.manage'),
    (v_role,'pipeline.configure'),(v_role,'pipeline.move'),(v_role,'assignment.configure'),
    (v_role,'leads.read.team'),(v_role,'leads.update'),(v_role,'leads.assign'),
    (v_role,'leads.reassign'),(v_role,'leads.classify.override'),
    (v_role,'conversations.read.private'),(v_role,'conversations.reply'),
    (v_role,'conversations.takeover'),(v_role,'conversations.transfer'),
    (v_role,'tasks.manage'),(v_role,'calls.manage'),(v_role,'sitevisits.read'),
    (v_role,'sitevisits.manage'),(v_role,'scoring.read'),(v_role,'scoring.edit'),
    (v_role,'scoring.approve'),(v_role,'scoring.publish'),(v_role,'projects.read'),
    (v_role,'inventory.read'),(v_role,'analytics.sales.read'),(v_role,'analytics.agents.read')
    on conflict do nothing;

  -- sales_agent
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'sales_agent', 'Sales Agent', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'leads.read.assigned'),(v_role,'leads.update'),
    (v_role,'conversations.read.assigned'),(v_role,'conversations.reply'),
    (v_role,'conversations.takeover'),(v_role,'pipeline.move'),(v_role,'tasks.manage'),
    (v_role,'calls.manage'),(v_role,'sitevisits.read'),(v_role,'sitevisits.manage'),
    (v_role,'projects.read'),(v_role,'inventory.read'),(v_role,'scoring.read')
    on conflict do nothing;

  -- project_maintenance (NO private conversation access)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'project_maintenance', 'Project Data & Maintenance', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'projects.read'),(v_role,'projects.manage'),(v_role,'inventory.read'),
    (v_role,'inventory.manage'),(v_role,'inventory.import'),(v_role,'knowledge.manage'),
    (v_role,'knowledge.approve'),(v_role,'staledata.resolve')
    on conflict do nothing;

  -- viewer (read-only)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'viewer', 'Viewer', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'projects.read'),(v_role,'inventory.read'),(v_role,'leads.read.team'),
    (v_role,'sitevisits.read'),(v_role,'analytics.sales.read'),(v_role,'analytics.marketing.read'),
    (v_role,'analytics.agents.read'),(v_role,'attribution.read'),(v_role,'billing.read'),
    (v_role,'scoring.read')
    on conflict do nothing;
end;
$$;

-- On tenant creation: provision branding + settings rows and default roles.
create or replace function public.on_tenant_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  return new;
end;
$$;

create trigger trg_on_tenant_created
  after insert on public.tenants
  for each row execute function public.on_tenant_created();

-- ---------------------------------------------------------------------------
-- (2) Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.tenants            enable row level security;
alter table public.tenant_branding    enable row level security;
alter table public.tenant_settings    enable row level security;
alter table public.tenant_features    enable row level security;
alter table public.profiles           enable row level security;
alter table public.permissions        enable row level security;
alter table public.roles              enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.memberships        enable row level security;
alter table public.user_permissions   enable row level security;
alter table public.invitations        enable row level security;

-- tenants: members can read their tenant; platform admin reads all & writes.
create policy tenants_select on public.tenants for select
  using (public.is_platform_admin() or public.is_active_member(id));
create policy tenants_write on public.tenants for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- branding / settings / features: members read; managers (active tenant) write.
-- NOTE: platform admin has NO silent read of tenant config — tenant access is
-- only via the audited impersonation model (docs/SECURITY.md §5).
create policy branding_select on public.tenant_branding for select
  using (public.is_active_member(tenant_id));
create policy branding_write on public.tenant_branding for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.branding.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.branding.manage'));

create policy settings_select on public.tenant_settings for select
  using (public.is_active_member(tenant_id));
create policy settings_write on public.tenant_settings for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));

create policy features_select on public.tenant_features for select
  using (public.is_active_member(tenant_id));
create policy features_write on public.tenant_features for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));

-- profiles: read self, co-members in a shared tenant, or platform admin.
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.memberships me
      join public.memberships them on them.tenant_id = me.tenant_id
      where me.profile_id = auth.uid() and me.status = 'active'
        and them.profile_id = public.profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- permissions: global static catalog, readable by any authenticated user.
create policy permissions_select on public.permissions for select
  using (auth.role() = 'authenticated');

-- roles / role_permissions: read if platform template or member of the role's
-- tenant; write requires settings.roles.manage in the active tenant.
create policy roles_select on public.roles for select
  using (tenant_id is not null and public.is_active_member(tenant_id));
create policy roles_write on public.roles for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.roles.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.roles.manage'));

create policy role_perms_select on public.role_permissions for select
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_id
        and r.tenant_id is not null and public.is_active_member(r.tenant_id)
    )
  );
create policy role_perms_write on public.role_permissions for all
  using (
    exists (select 1 from public.roles r
            where r.id = role_id and r.tenant_id = public.current_tenant_id())
    and public.has_permission('settings.roles.manage')
  )
  with check (
    exists (select 1 from public.roles r
            where r.id = role_id and r.tenant_id = public.current_tenant_id())
    and public.has_permission('settings.roles.manage')
  );

-- memberships: read own, or co-member with team/users permission; write needs users.manage.
create policy memberships_select on public.memberships for select
  using (
    profile_id = auth.uid()
    or (tenant_id = public.current_tenant_id()
        and public.has_permission('team.performance.read'))
    or (tenant_id = public.current_tenant_id()
        and public.has_permission('users.manage'))
  );
create policy memberships_write on public.memberships for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('users.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('users.manage'));

-- user_permissions: managed with roles/users permission in the active tenant.
create policy user_perms_select on public.user_permissions for select
  using (
    profile_id = auth.uid()
    or (tenant_id = public.current_tenant_id() and public.has_permission('settings.roles.manage'))
  );
create policy user_perms_write on public.user_permissions for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.roles.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.roles.manage'));

-- invitations: managed by users.invite in the active tenant.
create policy invitations_select on public.invitations for select
  using (tenant_id = public.current_tenant_id() and public.has_permission('users.invite'));
create policy invitations_write on public.invitations for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('users.invite'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('users.invite'));
