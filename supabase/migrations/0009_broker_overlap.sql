-- 0009_broker_overlap.sql
-- Phase 3 remainder — broker/direct overlap (MASTER_SPEC §9). When the same
-- buyer arrives both directly and via a broker/third party, the duplicate is
-- flagged as a potential attribution/commission conflict. Resolution records
-- source precedence + estimated commission exposure; ownership is NEVER decided
-- automatically.

alter table public.lead_duplicates
  add column is_broker_conflict boolean not null default false;

alter table public.duplicate_resolution_events
  add column source_precedence text,
  add column commission_exposure numeric(14, 2);

-- Optional retained metric: estimated commission exposure prevented per tenant.
create or replace view public.broker_overlap_metrics as
  select
    tenant_id,
    count(*) filter (where is_broker_conflict) as broker_conflicts_identified
  from public.lead_duplicates
  group by tenant_id;
