-- pgTAP RLS / tenant-isolation tests (docs/TEST_PLAN.md §3).
-- Run with: supabase test db
-- Verifies: tenant isolation on branding, role-bundle correctness, and the
-- critical rule that project_maintenance cannot read private conversations.

begin;
select plan(8);

-- Helper to simulate an authenticated request: set the JWT subject + active tenant.
create or replace function tests.act_as(p_user uuid, p_tenant uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role','authenticated')::text, true);
  perform set_config('app.current_tenant', p_tenant::text, true);
end; $$;

-- 1. effective_permissions: Northwind client_admin can publish scoring.
select ok(
  exists (
    select 1 from public.effective_permissions(
      '00000000-0000-0000-0000-0000000000a1',
      '11111111-1111-1111-1111-111111111111')
    where permission_key = 'scoring.publish'),
  'client_admin has scoring.publish');

-- 2. sales_agent is limited to assigned leads (no leads.read.all).
select ok(
  not exists (
    select 1 from public.effective_permissions(
      '00000000-0000-0000-0000-0000000000a2',
      '11111111-1111-1111-1111-111111111111')
    where permission_key = 'leads.read.all'),
  'sales_agent lacks leads.read.all');
select ok(
  exists (
    select 1 from public.effective_permissions(
      '00000000-0000-0000-0000-0000000000a2',
      '11111111-1111-1111-1111-111111111111')
    where permission_key = 'leads.read.assigned'),
  'sales_agent has leads.read.assigned');

-- 3. project_maintenance role exists and EXCLUDES conversations.read.private.
select ok(
  not exists (
    select 1 from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.tenant_id = '11111111-1111-1111-1111-111111111111'
      and r.slug = 'project_maintenance'
      and rp.permission_key = 'conversations.read.private'),
  'project_maintenance cannot read private conversations');

-- 4. RLS: as Northwind admin, only Northwind branding is visible.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-0000000000a1',
                    '11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.tenant_branding),
  1, 'Northwind admin sees exactly one branding row (their own)');
select is(
  (select tenant_id from public.tenant_branding),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the visible branding row is Northwind');

-- 5. RLS: Northwind admin CANNOT see Skyline tenant.
select is(
  (select count(*)::int from public.tenants
     where id = '22222222-2222-2222-2222-222222222222'),
  0, 'Northwind admin cannot see Skyline tenant');

-- 6. has_permission honors active tenant context.
select ok(public.has_permission('settings.branding.manage'),
  'Northwind admin has settings.branding.manage in active tenant');

reset role;
select * from finish();
rollback;
