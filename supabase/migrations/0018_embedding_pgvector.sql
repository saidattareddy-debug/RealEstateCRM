-- =====================================================================
-- Phase 5A remediation — canonical embedding similarity moves INTO THE DATABASE.
-- Forward-only; migration 0017 is NOT rewritten.
--
-- Problem fixed: retrieval previously loaded jsonb embedding arrays into Node and
-- computed cosine in application code, with no embedding-model-configuration or
-- dimension filtering. That is removed.
--
-- After this migration the canonical similarity is computed in the database by
-- `match_knowledge_chunks(...)`, which:
--   * runs SECURITY INVOKER so the caller's RLS (tenant + project) applies,
--   * filters to approved + in-effect chunks of the SELECTED embedding-model
--     configuration with MATCHING dimensions BEFORE any comparison
--     (mixed-model isolation + dimension compatibility), and
--   * computes cosine similarity in SQL.
--
-- Where the pgvector extension is available (production Supabase) the migration
-- ALSO adds a canonical pgvector `embedding` column, a dimension-match CHECK, a
-- trigger that keeps it in sync with the jsonb array the application writes, and
-- a `<=>`-based variant of the function — the performance/ANN path. The
-- embedded-Postgres test harness has no pgvector, so it exercises the portable
-- SQL-cosine variant; the pgvector `<=>` path is verified on a live project
-- (a sanctioned deferral — see docs/RAG_ARCHITECTURE.md, "production indexing").
-- =====================================================================

-- ---- Provenance columns (always present) ----------------------------------
alter table public.knowledge_chunk_embeddings
  add column project_id uuid references public.projects(id) on delete cascade,
  add column model_name text,
  add column distance_metric text not null default 'cosine'
    check (distance_metric in ('cosine', 'l2', 'ip')),
  add column checksum text,
  add column superseded_at timestamptz,
  add column error_state text;

update public.knowledge_chunk_embeddings e
  set project_id = kc.project_id
  from public.knowledge_chunks kc
  where kc.id = e.chunk_id and e.project_id is null;

create index idx_kce_lookup
  on public.knowledge_chunk_embeddings (tenant_id, embedding_model_config_id, dimensions)
  where superseded_at is null;

-- ---- Portable in-SQL cosine over two equal-length jsonb numeric arrays -----
create or replace function public.cosine_sim_jsonb(a jsonb, b jsonb)
returns double precision
language sql
immutable
as $$
  select case when na = 0 or nb = 0 then 0 else dot / (sqrt(na) * sqrt(nb)) end
  from (
    select sum(x * y) as dot, sum(x * x) as na, sum(y * y) as nb
    from (
      select (ax.val)::float8 as x, (bx.val)::float8 as y
      from jsonb_array_elements_text(a) with ordinality ax(val, i)
      join jsonb_array_elements_text(b) with ordinality bx(val, j) on ax.i = bx.j
    ) pairs
  ) s;
$$;

-- ---- pgvector path (only when the extension is installed) ------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    -- Canonical pgvector column + dimension-match CHECK.
    execute 'alter table public.knowledge_chunk_embeddings add column embedding extensions.vector';
    execute 'alter table public.knowledge_chunk_embeddings
             add constraint kce_dim_match
             check (embedding is null or extensions.vector_dims(embedding) = dimensions)';
    -- Backfill from the jsonb arrays (already valid vector literals once trimmed).
    execute 'update public.knowledge_chunk_embeddings
             set embedding = replace(vector::text, '' '', '''')::extensions.vector
             where embedding is null and jsonb_typeof(vector) = ''array'' and vector <> ''[]''::jsonb';
    -- Keep the pgvector column in sync with the jsonb the application writes.
    execute $f$
      create or replace function public.sync_embedding_vector()
      returns trigger language plpgsql set search_path = public, extensions as $b$
      begin
        if new.vector is not null and jsonb_typeof(new.vector) = 'array' and new.vector <> '[]'::jsonb then
          new.embedding := replace(new.vector::text, ' ', '')::extensions.vector;
        end if;
        return new;
      end $b$;
    $f$;
    execute 'create trigger trg_sync_embedding_vector
             before insert or update of vector on public.knowledge_chunk_embeddings
             for each row execute function public.sync_embedding_vector()';
    -- ANN performance index is added per fixed model/dimension on a live project.
    -- Canonical function: pgvector cosine distance.
    execute $f$
      create or replace function public.match_knowledge_chunks(
        p_project uuid, p_query jsonb, p_model_config uuid, p_dim integer, p_limit integer)
      returns table (chunk_id uuid, source_id uuid, source_version_id uuid, language text,
                     trust_priority integer, content text, similarity double precision)
      language sql stable security invoker set search_path = public, extensions as $b$
        select kc.id, kc.source_id, kc.source_version_id, kc.language, kc.trust_priority, kc.content,
               1 - (e.embedding <=> replace(p_query::text, ' ', '')::extensions.vector) as similarity
        from public.knowledge_chunk_embeddings e
        join public.knowledge_chunks kc on kc.id = e.chunk_id
        join public.knowledge_sources ks on ks.id = kc.source_id
        where kc.state = 'approved' and e.embedding is not null and e.superseded_at is null
          and e.embedding_model_config_id is not distinct from p_model_config
          and e.dimensions = p_dim and extensions.vector_dims(e.embedding) = p_dim
          and (kc.project_id = p_project or kc.project_id is null)
          and (kc.effective_at is null or kc.effective_at <= now())
          and (kc.expires_at is null or kc.expires_at >= now())
          and (ks.effective_at is null or ks.effective_at <= now())
          and (ks.expires_at is null or ks.expires_at >= now())
        order by e.embedding <=> replace(p_query::text, ' ', '')::extensions.vector
        limit greatest(1, least(coalesce(p_limit, 8), 50));
      $b$;
    $f$;
  else
    -- Portable function: in-SQL cosine over the jsonb arrays (same signature,
    -- same filters). Used by the test harness and any pgvector-less environment.
    execute $f$
      create or replace function public.match_knowledge_chunks(
        p_project uuid, p_query jsonb, p_model_config uuid, p_dim integer, p_limit integer)
      returns table (chunk_id uuid, source_id uuid, source_version_id uuid, language text,
                     trust_priority integer, content text, similarity double precision)
      language sql stable security invoker set search_path = public as $b$
        select kc.id, kc.source_id, kc.source_version_id, kc.language, kc.trust_priority, kc.content,
               public.cosine_sim_jsonb(p_query, e.vector) as similarity
        from public.knowledge_chunk_embeddings e
        join public.knowledge_chunks kc on kc.id = e.chunk_id
        join public.knowledge_sources ks on ks.id = kc.source_id
        where kc.state = 'approved' and e.superseded_at is null
          and e.embedding_model_config_id is not distinct from p_model_config
          and e.dimensions = p_dim
          and jsonb_array_length(e.vector) = p_dim
          and (kc.project_id = p_project or kc.project_id is null)
          and (kc.effective_at is null or kc.effective_at <= now())
          and (kc.expires_at is null or kc.expires_at >= now())
          and (ks.effective_at is null or ks.effective_at <= now())
          and (ks.expires_at is null or ks.expires_at >= now())
        order by public.cosine_sim_jsonb(p_query, e.vector) desc
        limit greatest(1, least(coalesce(p_limit, 8), 50));
      $b$;
    $f$;
  end if;
end $$;
