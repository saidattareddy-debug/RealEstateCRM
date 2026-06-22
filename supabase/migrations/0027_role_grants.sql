-- 0027_role_grants.sql
-- Make Row-Level Security the SOLE gatekeeper.
--
-- Every tenant table has RLS enabled with default-deny policies. For those
-- policies to actually decide access, the Supabase auth roles must hold the
-- underlying table/sequence/function privileges — otherwise PostgreSQL rejects
-- the query with "permission denied for table" before RLS is ever consulted.
--
-- This mirrors the local RLS harness setup (supabase/tests/local-harness) and
-- Supabase's standard role model. It is idempotent and safe to re-run: RLS still
-- restricts which ROWS each authenticated user can see/modify.

grant usage on schema public to anon, authenticated;

-- Authenticated users operate strictly under RLS (default-deny). Granting table
-- privileges lets the policies — not missing grants — govern access.
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- Cover objects created by any future migration as well (migrations run as the
-- same owner role, so these default privileges apply to their new objects).
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
