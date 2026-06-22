-- 0001_extensions.sql
-- Foundational extensions. Schema is owned exclusively by these migrations
-- (CLAUDE.md §3). pgvector + full-text search are enabled now so later phases
-- (RAG, global search) need no schema surprises.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;      -- gen_random_uuid()
create extension if not exists citext with schema extensions;        -- case-insensitive email
create extension if not exists pg_trgm with schema extensions;       -- fuzzy name matching (dedupe)
create extension if not exists vector with schema extensions;        -- pgvector (RAG, later phase)

-- Generic updated_at trigger function used across tenant tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
