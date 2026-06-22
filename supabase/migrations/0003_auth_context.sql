-- 0003_auth_context.sql
-- Authorization helpers used by RLS (docs/SECURITY.md §3) and the permission
-- catalog seed. The active tenant is supplied per request via the GUC
-- `app.current_tenant`, set server-side AFTER membership is verified — never
-- from a client-supplied value (CLAUDE.md §2).

-- Current authenticated profile (= auth.users.id).
create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- Active tenant for this request (null if unset). Read from a request GUC
-- (set by pgTAP tests / server transactions) with a fallback to the
-- `active_tenant` custom claim in the user's JWT app_metadata, which is how the
-- web app conveys the active tenant over PostgREST (see apps/web tenant switch).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.current_tenant', true), '')::uuid,
    nullif(((auth.jwt() -> 'app_metadata') ->> 'active_tenant'), '')::uuid
  );
$$;

-- True if the current user is a platform super admin.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Active membership of the current user in the active tenant.
create or replace function public.is_active_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.profile_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- Effective permission keys for a profile within a tenant:
-- (role permissions ∪ user grants) − user revocations.
create or replace function public.effective_permissions(p_profile uuid, p_tenant uuid)
returns table (permission_key text)
language sql
stable
security definer
set search_path = public
as $$
  with role_perms as (
    select rp.permission_key
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.profile_id = p_profile
      and m.tenant_id = p_tenant
      and m.status = 'active'
  ),
  grants as (
    select up.permission_key
    from public.user_permissions up
    where up.profile_id = p_profile
      and up.tenant_id = p_tenant
      and up.effect = 'grant'
  ),
  revokes as (
    select up.permission_key
    from public.user_permissions up
    where up.profile_id = p_profile
      and up.tenant_id = p_tenant
      and up.effect = 'revoke'
  )
  select permission_key from (
    select permission_key from role_perms
    union
    select permission_key from grants
  ) merged
  where permission_key not in (select permission_key from revokes);
$$;

-- Does the current user hold a permission in the active tenant?
-- Honors read-scope implication (leads.read.all ⊃ team ⊃ assigned, etc.),
-- mirroring packages/domain/rbac.ts so DB and app agree.
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with eff as (
    select permission_key
    from public.effective_permissions(auth.uid(), public.current_tenant_id())
  )
  select exists (
    select 1 from eff where permission_key = p_key
  )
  or (
    p_key = 'leads.read.team'
    and exists (select 1 from eff where permission_key = 'leads.read.all')
  )
  or (
    p_key = 'leads.read.assigned'
    and exists (select 1 from eff where permission_key in ('leads.read.all','leads.read.team'))
  )
  or (
    p_key = 'conversations.read.assigned'
    and exists (select 1 from eff where permission_key = 'conversations.read.private')
  );
$$;

-- ---------------------------------------------------------------------------
-- Seed the global permission catalog (keys mirror packages/validation).
-- ---------------------------------------------------------------------------
insert into public.permissions (key) values
  ('platform.tenants.create'),('platform.tenants.suspend'),('platform.plans.manage'),
  ('platform.health.read'),('platform.integrations.manage'),('platform.models.configure'),
  ('platform.domains.manage'),('platform.billing.read'),('platform.impersonate'),
  ('settings.branding.manage'),('settings.org.manage'),('settings.roles.manage'),
  ('settings.integrations.manage'),('settings.security.manage'),('settings.retention.manage'),
  ('settings.audit.read'),
  ('users.invite'),('users.manage'),('agents.manage'),('agents.availability.manage'),
  ('team.performance.read'),
  ('projects.read'),('projects.manage'),('inventory.read'),('inventory.manage'),
  ('inventory.import'),('knowledge.manage'),('knowledge.approve'),('staledata.resolve'),
  ('leads.read.assigned'),('leads.read.team'),('leads.read.all'),('leads.create'),
  ('leads.update'),('leads.assign'),('leads.reassign'),('leads.merge'),('leads.export'),
  ('leads.classify.override'),
  ('conversations.read.assigned'),('conversations.read.private'),('conversations.reply'),
  ('conversations.takeover'),('conversations.transfer'),
  ('pipeline.configure'),('pipeline.move'),('tasks.manage'),('calls.manage'),
  ('sitevisits.read'),('sitevisits.manage'),
  ('scoring.read'),('scoring.edit'),('scoring.approve'),('scoring.publish'),
  ('automations.manage'),('assignment.configure'),
  ('campaigns.manage'),('sources.manage'),('forms.manage'),('attribution.read'),
  ('analytics.marketing.read'),
  ('analytics.sales.read'),('analytics.agents.read'),('analytics.ai.read'),('analytics.cost.read'),
  ('billing.read'),('billing.manage')
on conflict (key) do nothing;
