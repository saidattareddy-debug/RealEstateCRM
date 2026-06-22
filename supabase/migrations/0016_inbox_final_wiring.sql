-- =====================================================================
-- Phase 4.1 — final wiring. Forward-only schema needed to safely complete
-- already-designed workflows: richer SLA-event provenance, assignment
-- eligibility signals, minimal teams, canned-reply usage (without storing the
-- resolved message), and saved-view inbox fields. No AI is enabled here.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. SLA events — full lifecycle kinds + provenance
--    (started / due calculated / recalculated / due soon / breached /
--     breach resolved / paused / resumed / closed / reopened)
-- ---------------------------------------------------------------------------
alter table public.conversation_sla_events
  drop constraint conversation_sla_events_kind_check;
alter table public.conversation_sla_events
  add constraint conversation_sla_events_kind_check check (kind in (
    'started','first_response_due','due_recalculated','due_soon',
    'first_response_met','breach','breach_resolved','paused','resumed',
    'closed','reopened'
  ));
alter table public.conversation_sla_events
  add column previous_due_at timestamptz,
  add column reason text,
  add column correlation_id text;

-- Persist the last computed SLA status on the conversation so event derivation
-- can diff deterministically (paused/resumed/due_soon/breach transitions)
-- without reconstructing the whole event history.
alter table public.conversations
  add column sla_status text;

-- ---------------------------------------------------------------------------
-- 2. Assignment eligibility signals on memberships (extend, don't fork)
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column availability text not null default 'available'
    check (availability in ('available','busy','away')),
  add column absent_from timestamptz,
  add column absent_until timestamptz,
  add column max_active_conversations integer not null default 0
    check (max_active_conversations >= 0),
  add column languages text[] not null default '{}'::text[];

-- ---------------------------------------------------------------------------
-- 3. Teams (minimal) — required to complete the team-assignment workflow
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index idx_teams_tenant on public.teams (tenant_id, active);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index idx_team_members_profile on public.team_members (profile_id);

alter table public.conversations
  add column assigned_team_id uuid references public.teams(id) on delete set null;
create index idx_conversations_team on public.conversations (assigned_team_id)
  where assigned_team_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Canned-reply usage — records WHICH reply was used, never the resolved body
-- ---------------------------------------------------------------------------
create table public.canned_reply_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  canned_reply_id uuid not null references public.canned_replies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  used_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_canned_usage on public.canned_reply_usage_events (canned_reply_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Saved-view inbox fields (extend the existing system; no parallel model)
-- ---------------------------------------------------------------------------
alter table public.saved_views
  add column section text,
  add column density text not null default 'comfortable'
    check (density in ('comfortable','compact')),
  add column panels jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- RLS — new tables (per-command writes; SELECT stays member-scoped)
-- ---------------------------------------------------------------------------
alter table public.teams                      enable row level security;
alter table public.team_members               enable row level security;
alter table public.canned_reply_usage_events  enable row level security;

create policy teams_sel on public.teams for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id));
create policy teams_ins on public.teams for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'));
create policy teams_upd on public.teams for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'));
create policy teams_del on public.teams for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'));

create policy team_members_sel on public.team_members for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id));
create policy team_members_ins on public.team_members for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'));
create policy team_members_del on public.team_members for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('assignment.configure'));

create policy canned_usage_sel on public.canned_reply_usage_events for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id));
create policy canned_usage_ins on public.canned_reply_usage_events for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('conversations.reply')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.tenant_id = public.current_tenant_id()
    )
  );
