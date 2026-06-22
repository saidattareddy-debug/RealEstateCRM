-- 0003_projects_inventory_rls_test.sql
-- Phase 2 — RLS coverage for projects & inventory. Run with: supabase test db.
-- Mirrors the Phase-2 block of supabase/tests/local-harness/run.mjs (75/75).

begin;
create schema if not exists tests;
grant usage on schema tests to public;
select plan(16);

\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set AA '00000000-0000-0000-0000-0000000000a1'
\set AG '00000000-0000-0000-0000-0000000000a2'
\set BA '00000000-0000-0000-0000-0000000000b1'
\set PROJ '33333333-3333-3333-3333-333333333333'

create or replace function tests.act(p_uid uuid, p_tenant uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('app.current_tenant', coalesce(p_tenant::text, ''), true);
end; $$;

-- projects
select tests.act(:'AA', :'A');
select ok((select count(*) from projects where id=:'PROJ') >= 1, 'projects: A-admin sees seeded project');
select lives_ok($$insert into projects(tenant_id,name,category) values ('11111111-1111-1111-1111-111111111111','P2','villa')$$,
  'projects: A-admin own INSERT allowed');
select throws_ok($$insert into projects(tenant_id,name,category) values ('22222222-2222-2222-2222-222222222222','P3','villa')$$,
  '42501', null, 'projects: A-admin cross INSERT denied');
select tests.act(:'BA', :'B');
select is((select count(*) from projects where tenant_id=:'A')::int, 0, 'projects: B-admin cannot see A projects');
select tests.act(:'AG', :'A');
select ok((select count(*) from projects where id=:'PROJ') >= 1, 'projects: agent (read) can SELECT');
select throws_ok($$insert into projects(tenant_id,name,category) values ('11111111-1111-1111-1111-111111111111','PX','plot')$$,
  '42501', null, 'projects: agent without manage INSERT denied');

-- inventory units
select tests.act(:'AA', :'A');
select is((select count(*) from inventory_units where project_id=:'PROJ')::int, 3, 'inventory: A-admin sees seeded units');
select is((select count(*) from inventory_units where tenant_id=:'B')::int, 0, 'inventory: A-admin cross SELECT 0');
select lives_ok($$update inventory_units set status='reserved'
  where project_id='33333333-3333-3333-3333-333333333333' and unit_number='A-101'$$,
  'inventory: A-admin own status UPDATE allowed');
select tests.act(:'AG', :'A');
with u as (update inventory_units set status='blocked'
  where project_id=:'PROJ' returning 1)
select is((select count(*) from u)::int, 0,
  'inventory: agent without manage UPDATE 0 rows');
select tests.act(:'BA', :'B');
select is((select count(*) from inventory_units where tenant_id=:'A')::int, 0, 'inventory: B-admin cannot see A units');

-- history (trigger-maintained, append-only)
select tests.act(:'AA', :'A');
select ok((select count(*) from inventory_status_events where tenant_id=:'A') >= 3,
  'history: status events recorded by trigger');
select ok((select count(*) from inventory_price_history where tenant_id=:'A') >= 3,
  'history: price history recorded by trigger');
with u as (update inventory_status_events set new_status='sold' where tenant_id=:'A' returning 1)
select is((select count(*) from u)::int, 0, 'history: append-only (UPDATE 0 rows)');

-- imports permission
select lives_ok($$insert into inventory_imports(tenant_id,project_id,filename)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','x.csv')$$,
  'imports: A-admin (inventory.import) INSERT allowed');
select tests.act(:'AG', :'A');
select throws_ok($$insert into inventory_imports(tenant_id,project_id,filename)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','y.csv')$$,
  '42501', null, 'imports: agent without inventory.import INSERT denied');

reset role;
select * from finish();
rollback;
