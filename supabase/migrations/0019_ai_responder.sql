-- =====================================================================
-- Phase 5B (behind the safety boundary) — automatic-responder decision record.
-- Forward-only. The responder is built but CANNOT send: every decision is
-- recorded here, and a database CHECK makes the 'deliver' outcome impossible in
-- this phase, mirroring the compile-time `RESPONDER_LIVE_SENDING = false` gate.
-- No customer message is ever inserted by the responder; this table is the
-- internal trace + agent-review surface.
-- =====================================================================

create table public.ai_responder_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  run_id uuid references public.ai_runs(id) on delete set null,
  outcome text not null check (outcome in ('escalate', 'suppressed', 'blocked')),
  reason text not null,
  -- The would-be reply text. INTERNAL ONLY — never delivered to a customer in
  -- this phase. Retained for agent review + evaluation.
  candidate_body text,
  gates jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_ai_responder_decisions
  on public.ai_responder_decisions (tenant_id, conversation_id, created_at desc);

-- The 'deliver' outcome is intentionally absent from the CHECK above: while the
-- responder is behind the boundary the database itself rejects a delivered
-- decision, so a forged insert cannot record (or imply) an automatic send.

alter table public.ai_responder_decisions enable row level security;

create policy ai_responder_sel on public.ai_responder_decisions for select
  using (
    tenant_id = public.current_tenant_id()
    and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read')
  );
create policy ai_responder_ins on public.ai_responder_decisions for insert
  with check (
    tenant_id = public.current_tenant_id()
    and (public.has_permission('ai.copilot.use') or public.has_permission('ai.test_lab.use'))
  );

insert into public.audit_actions (key, category, description, is_security) values
  ('ai.responder.decision', 'configuration', 'AI responder produced a (non-sent) decision', false)
on conflict (key) do nothing;
