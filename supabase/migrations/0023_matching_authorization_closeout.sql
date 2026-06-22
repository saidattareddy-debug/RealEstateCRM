-- =====================================================================
-- Phase 6B closeout — authorization hardening + AI preference extraction.
-- Forward-only. Still advisory: nothing here sends, reserves inventory, or
-- mutates a lead. No Phase 5B delivery constraint is widened.
--
-- 1. Lead-visibility INHERITANCE on the lead-scoped matching tables: a user may
--    read a match run/candidate/component/snapshot/override/feedback row only
--    when the underlying LEAD is visible to them (the leads RLS — all/team/
--    assigned — is inherited via an EXISTS sub-query). Previously these were
--    scoped only by tenant + `matching.read`, over-exposing other agents' leads.
-- 2. A proper AI-preference-extraction table with full provenance + a review
--    state machine + idempotency (replacing the stop-gap that stored proposals
--    on `lead_match_overrides`).
-- 3. Inventory-snapshot price/configuration/freshness provenance.
-- =====================================================================

-- ---- 1. Lead-visibility inheritance ---------------------------------------
drop policy if exists lead_match_runs_sel on public.lead_match_runs;
create policy lead_match_runs_sel on public.lead_match_runs for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (select 1 from public.leads l where l.id = lead_match_runs.lead_id)
  );

drop policy if exists lead_match_candidates_sel on public.lead_match_candidates;
create policy lead_match_candidates_sel on public.lead_match_candidates for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (
      select 1 from public.lead_match_runs r join public.leads l on l.id = r.lead_id
      where r.id = lead_match_candidates.run_id
    )
  );

drop policy if exists lead_match_components_sel on public.lead_match_components;
create policy lead_match_components_sel on public.lead_match_components for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (
      select 1 from public.lead_match_candidates c
        join public.lead_match_runs r on r.id = c.run_id
        join public.leads l on l.id = r.lead_id
      where c.id = lead_match_components.candidate_id
    )
  );

drop policy if exists lead_match_inventory_snapshots_sel on public.lead_match_inventory_snapshots;
create policy lead_match_inventory_snapshots_sel on public.lead_match_inventory_snapshots for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (
      select 1 from public.lead_match_runs r join public.leads l on l.id = r.lead_id
      where r.id = lead_match_inventory_snapshots.run_id
    )
  );

drop policy if exists lmo_sel on public.lead_match_overrides;
create policy lmo_sel on public.lead_match_overrides for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (select 1 from public.leads l where l.id = lead_match_overrides.lead_id)
  );

drop policy if exists lmf_sel on public.lead_match_feedback;
create policy lmf_sel on public.lead_match_feedback for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (select 1 from public.leads l where l.id = lead_match_feedback.lead_id)
  );

-- ---- 2. AI preference extraction (structured, reviewable, idempotent) -------
create type public.match_extraction_state as enum ('pending', 'approved', 'rejected');

create table public.lead_match_preference_extractions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  signal_key text not null,
  value jsonb,
  value_type text not null default 'string',
  -- Provenance: which messages + the exact (safe) span the value came from.
  source_message_ids uuid[] not null default '{}',
  source_span text,
  prompt_version text,
  model_config text,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  -- Idempotency: a stable key makes duplicate extraction a no-op.
  idempotency_key text not null,
  review_state public.match_extraction_state not null default 'pending',
  correlation_id text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  -- Fairness: a protected attribute can never be an extracted preference.
  constraint extraction_not_prohibited check (not public.is_prohibited_signal(signal_key))
);
create index idx_match_extractions on public.lead_match_preference_extractions (tenant_id, lead_id, review_state);

alter table public.lead_match_preference_extractions enable row level security;
-- Read: matching.read + lead visibility. A pending/rejected extraction never
-- affects ranking (it lives only here until explicitly approved + applied).
create policy lmpe_sel on public.lead_match_preference_extractions for select
  using (
    tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('matching.read')
    and exists (select 1 from public.leads l where l.id = lead_match_preference_extractions.lead_id)
  );
create policy lmpe_ins on public.lead_match_preference_extractions for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('matching.override'));
create policy lmpe_upd on public.lead_match_preference_extractions for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('matching.override'));

-- ---- 3. Inventory-snapshot provenance --------------------------------------
alter table public.lead_match_inventory_snapshots
  add column configuration_id uuid references public.project_configurations(id) on delete set null,
  add column price numeric,
  add column price_verified_at timestamptz,
  add column freshness_window_days integer,
  add column freshness_state text;
