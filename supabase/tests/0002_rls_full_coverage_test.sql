-- 0002_rls_full_coverage_test.sql
-- Phase 1.1 — explicit RLS coverage for EVERY tenant-owned table + scenarios.
-- Run with: supabase test db
-- Mirrors supabase/tests/local-harness/run.mjs (which proved 56/56 on a real
-- embedded Postgres). No table is left "pattern-covered".

begin;
create schema if not exists tests;
grant usage on schema tests to public;
select plan(51);

-- Seeded identifiers (see supabase/seed/seed.sql).
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set P  '00000000-0000-0000-0000-000000000001'
\set AA '00000000-0000-0000-0000-0000000000a1'
\set AG '00000000-0000-0000-0000-0000000000a2'
\set BA '00000000-0000-0000-0000-0000000000b1'

-- Context helpers (set the JWT subject, role and active tenant).
create or replace function tests.act(p_uid uuid, p_tenant uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('app.current_tenant', coalesce(p_tenant::text, ''), true);
end; $$;

create or replace function tests.act_forged(p_uid uuid, p_claim_tenant uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
      'app_metadata', json_build_object('active_tenant', p_claim_tenant))::text, true);
  perform set_config('app.current_tenant', '', true);
end; $$;

-- Committed audit/security rows for read tests (inserted as table owner).
insert into audit_logs (tenant_id, action, entity_type, entity_id)
  values (:'A', 'tenant.switch', 'tenant', :'A'), (:'B', 'tenant.switch', 'tenant', :'B');
insert into audit_logs (tenant_id, action) values (null, 'auth.sign_in.success');
insert into security_events (tenant_id, action, category, severity)
  values (:'A', 'auth.sign_in.failure', 'auth', 'medium');

-- ===================== tenants =====================
select tests.act(:'AA', :'A');
select is((select count(*) from tenants where id = :'A')::int, 1, 'tenants: A-admin sees own');
select is((select count(*) from tenants where id = :'B')::int, 0, 'tenants: A-admin cannot see B');

-- ===================== super admin: no silent tenant-data access =====================
select tests.act(:'P', null);
select is((select count(*) from tenant_branding)::int, 0, 'super-admin: 0 tenant branding (no silent access)');
select is((select count(*) from audit_logs where tenant_id is not null)::int, 0, 'super-admin: 0 tenant audit rows');
select ok((select count(*) from audit_logs where tenant_id is null) >= 1, 'super-admin: sees platform-scope audit');

-- ===================== tenant_branding =====================
select tests.act(:'AA', :'A');
select is((select count(*) from tenant_branding)::int, 1, 'branding: A-admin own SELECT=1');
select lives_ok($$update tenant_branding set accent_color='#123456' where tenant_id='11111111-1111-1111-1111-111111111111'$$,
  'branding: A-admin own UPDATE allowed');
select is((select count(*) from (select 1 from tenant_branding where tenant_id=:'B') s)::int, 0,
  'branding: A-admin cannot see B branding');
select tests.act(:'AG', :'A');
select is((select count(*) from tenant_branding where tenant_id=:'A')::int, 1, 'branding: agent can read own (member)');
-- agent lacks branding.manage: cross/own UPDATE affects 0 rows
do $$ begin perform tests.act('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111'); end $$;
with u as (update tenant_branding set accent_color='#000000'
  where tenant_id=:'A' returning 1)
select is((select count(*) from u)::int, 0, 'branding: member without permission UPDATE 0 rows');

-- ===================== tenant_settings =====================
select tests.act(:'AA', :'A');
select is((select count(*) from tenant_settings)::int, 1, 'settings: A-admin own SELECT=1');
select lives_ok($$update tenant_settings set currency='USD' where tenant_id='11111111-1111-1111-1111-111111111111'$$,
  'settings: A-admin own UPDATE allowed');
with u as (update tenant_settings set currency='GBP' where tenant_id=:'B' returning 1)
select is((select count(*) from u)::int, 0, 'settings: A-admin cross UPDATE 0 rows');

-- ===================== tenant_features =====================
select tests.act(:'AA', :'A');
select lives_ok($$insert into tenant_features(tenant_id,feature_key) values ('11111111-1111-1111-1111-111111111111','f1')$$,
  'features: A-admin own INSERT allowed');
select throws_ok($$insert into tenant_features(tenant_id,feature_key) values ('22222222-2222-2222-2222-222222222222','f2')$$,
  '42501', null, 'features: A-admin cross INSERT denied by RLS');
select tests.act(:'AG', :'A');
select throws_ok($$insert into tenant_features(tenant_id,feature_key) values ('11111111-1111-1111-1111-111111111111','f3')$$,
  '42501', null, 'features: member without permission INSERT denied');

-- ===================== roles =====================
select tests.act(:'AA', :'A');
select is((select count(*) from roles where tenant_id=:'A')::int, 6, 'roles: A-admin own SELECT=6');
select is((select count(*) from roles where tenant_id=:'B')::int, 0, 'roles: A-admin cross SELECT=0');
select lives_ok($$insert into roles(tenant_id,slug,name) values ('11111111-1111-1111-1111-111111111111','custom','Custom')$$,
  'roles: A-admin own INSERT allowed');
select throws_ok($$insert into roles(tenant_id,slug,name) values ('22222222-2222-2222-2222-222222222222','c2','C2')$$,
  '42501', null, 'roles: A-admin cross INSERT denied');
select tests.act(:'AG', :'A');
select throws_ok($$insert into roles(tenant_id,slug,name) values ('11111111-1111-1111-1111-111111111111','c3','C3')$$,
  '42501', null, 'roles: member without permission INSERT denied');

-- ===================== role_permissions =====================
select tests.act(:'AA', :'A');
select ok((select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.tenant_id=:'A') > 0,
  'role_permissions: A-admin sees own');
select is((select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.tenant_id=:'B')::int, 0,
  'role_permissions: A-admin cannot see B');

-- ===================== memberships =====================
select tests.act(:'AA', :'A');
select is((select count(*) from memberships where tenant_id=:'A')::int, 3, 'memberships: A-admin own SELECT=3');
select is((select count(*) from memberships where tenant_id=:'B')::int, 0, 'memberships: A-admin cross SELECT=0');
with u as (update memberships set status='suspended' where tenant_id=:'B' returning 1)
select is((select count(*) from u)::int, 0, 'memberships: A-admin cross UPDATE 0 rows');
select tests.act(:'AG', :'A');
select is((select count(*) from memberships)::int, 1, 'memberships: agent sees only own row');

-- ===================== user_permissions =====================
select tests.act(:'AA', :'A');
select lives_ok($$insert into user_permissions(tenant_id,profile_id,permission_key,effect)
  values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a2','leads.export','grant')$$,
  'user_permissions: A-admin own INSERT allowed');
select throws_ok($$insert into user_permissions(tenant_id,profile_id,permission_key,effect)
  values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000a2','leads.export','grant')$$,
  '42501', null, 'user_permissions: A-admin cross INSERT denied');

-- ===================== invitations =====================
select tests.act(:'AA', :'A');
select lives_ok($$insert into invitations(tenant_id,email,role_id,token)
  select '11111111-1111-1111-1111-111111111111','x@test.local',id,'tok1' from roles
  where tenant_id='11111111-1111-1111-1111-111111111111' and slug='viewer'$$,
  'invitations: A-admin own INSERT allowed');
select tests.act(:'AG', :'A');
select is((select count(*) from invitations)::int, 0, 'invitations: member without users.invite sees 0');

-- ===================== audit_logs =====================
select tests.act(:'AA', :'A');
select ok((select count(*) from audit_logs where tenant_id=:'A') >= 1, 'audit_logs: A-admin sees own tenant rows');
select is((select count(*) from audit_logs where tenant_id=:'B')::int, 0, 'audit_logs: A-admin cannot see B rows');
with u as (update audit_logs set action='auth.sign_out' where tenant_id=:'A' returning 1)
select is((select count(*) from u)::int, 0, 'audit_logs: append-only (UPDATE 0 rows)');
with d as (delete from audit_logs where tenant_id=:'A' returning 1)
select is((select count(*) from d)::int, 0, 'audit_logs: append-only (DELETE 0 rows)');
select tests.act(:'AG', :'A');
select is((select count(*) from audit_logs)::int, 0, 'audit_logs: member without audit.read sees 0');

-- ===================== security_events =====================
select tests.act(:'AA', :'A');
select ok((select count(*) from security_events where tenant_id=:'A') >= 1, 'security_events: A-admin sees own');
with u as (update security_events set status='ignored' where tenant_id=:'B' returning 1)
select is((select count(*) from u)::int, 0, 'security_events: A-admin cross UPDATE 0 rows');
select tests.act(:'AG', :'A');
select is((select count(*) from security_events)::int, 0, 'security_events: member without security.manage sees 0');

-- ===================== scenarios =====================
select tests.act(:'AG', :'A');
select ok(public.is_active_member(:'A'), 'scenario: agent is active member of A');
select ok(not public.is_active_member(:'B'), 'scenario: agent is NOT member of B');

-- forged active-tenant claim grants nothing
select tests.act_forged(:'AG', :'B');
select is((select count(*) from public.effective_permissions(:'AG', :'B'))::int, 0,
  'scenario: forged active_tenant=B grants no permissions');
select is((select count(*) from tenant_branding where tenant_id=:'B')::int, 0,
  'scenario: forged claim cannot read B branding');

-- missing tenant claim => has_permission false
select tests.act(:'AG', null);
select ok(not public.has_permission('leads.read.assigned'), 'scenario: missing tenant claim => has_permission false');

-- role-bundle invariants
select is((select count(*) from roles r join role_permissions rp on rp.role_id=r.id
  where r.tenant_id=:'A' and r.slug='viewer'
    and rp.permission_key in ('leads.update','projects.manage','scoring.publish','pipeline.move'))::int, 0,
  'scenario: viewer role has no mutation permissions');
select is((select count(*) from roles r join role_permissions rp on rp.role_id=r.id
  where r.tenant_id=:'A' and r.slug='sales_agent' and rp.permission_key='leads.read.all')::int, 0,
  'scenario: agent role is assigned-only');
select is((select count(*) from roles r join role_permissions rp on rp.role_id=r.id
  where r.tenant_id=:'A' and r.slug='project_maintenance' and rp.permission_key='conversations.read.private')::int, 0,
  'scenario: maintenance excludes private conversations');

-- permission overrides + disabled membership (mutate as owner; tx rolls back)
reset role;
insert into user_permissions(tenant_id, profile_id, permission_key, effect)
  values (:'A', :'AA', 'scoring.publish', 'revoke')
  on conflict (tenant_id, profile_id, permission_key) do update set effect = excluded.effect;
select is((select count(*) from public.effective_permissions(:'AA', :'A')
  where permission_key='scoring.publish')::int, 0, 'scenario: revoked override removes scoring.publish');
insert into user_permissions(tenant_id, profile_id, permission_key, effect)
  values (:'A', :'AG', 'leads.export', 'grant')
  on conflict (tenant_id, profile_id, permission_key) do update set effect = excluded.effect;
select is((select count(*) from public.effective_permissions(:'AG', :'A')
  where permission_key='leads.export')::int, 1, 'scenario: granted override adds leads.export');
update memberships set status='suspended' where profile_id=:'AG' and tenant_id=:'A';
select ok(not public.is_active_member(:'A'), 'scenario: suspended membership is not active');

select * from finish();
rollback;
