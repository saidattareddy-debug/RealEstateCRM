-- 0029_automations_visits.sql
-- Phase 8 — Automations & Visits (forward-only).
--
-- Workflow automations, score-aware follow-up sequences (with every stop
-- condition + "why sent" provenance), the site-visit lifecycle, a SIMULATION-ONLY
-- calendar (live Google sync is a Phase-7B/credential stop-condition), and
-- notifications. All tables are tenant-scoped with default-deny RLS.
--
-- SAFETY: customer SENDING remains impossible by construction. Automation
-- run-actions and follow-up step-events that target a customer carry a
-- `will_send boolean not null default false` column with a CHECK forbidding
-- `true`, so a delivered automatic message cannot even be recorded while the
-- compile-time LIVE_SEND_MASTER_SWITCH is false. Internal mutations
-- (stage/assignment/task/tag/note/notification) ARE permitted — Phase 8 is the
-- explicitly-approved automation phase.

-- ===========================================================================
-- 1. Automations
-- ===========================================================================
create table public.automations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  trigger text not null check (trigger in (
    'lead_created','lead_stage_changed','lead_score_changed','conversation_inbound',
    'conversation_idle','visit_scheduled','visit_completed','visit_no_show',
    'task_overdue','time_schedule')),
  enabled boolean not null default false,
  condition_group jsonb,
  max_runs_per_lead integer check (max_runs_per_lead is null or max_runs_per_lead > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_automations_tenant on public.automations (tenant_id, trigger, enabled);

create table public.automation_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  ordinal integer not null default 0,
  action_type text not null check (action_type in (
    'create_task','change_stage','assign_lead','add_tag','add_note','notify_user',
    'enroll_sequence','unenroll_sequence','send_whatsapp_template','send_email')),
  params jsonb not null default '{}'::jsonb,
  unique (automation_id, ordinal)
);

create table public.automation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  trigger text not null,
  matched boolean not null,
  skipped_reason text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_automation_runs_tenant on public.automation_runs (tenant_id, automation_id, created_at);

create table public.automation_run_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  action_type text not null,
  category text not null check (category in ('internal','customer_send')),
  -- Headline safety invariant: a customer send can NEVER be recorded as sent.
  will_send boolean not null default false check (will_send = false),
  suppressed_reason text,
  status text not null default 'pending'
    check (status in ('pending','executed','suppressed','failed','skipped')),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_automation_run_actions_tenant on public.automation_run_actions (tenant_id, run_id);

-- ===========================================================================
-- 2. Follow-up sequences
-- ===========================================================================
create table public.followup_sequences (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  stop_on_reply boolean not null default true,
  quiet_start_hour integer not null default 20 check (quiet_start_hour between 0 and 23),
  quiet_end_hour integer not null default 9 check (quiet_end_hour between 0 and 23),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_followup_sequences_tenant on public.followup_sequences (tenant_id, enabled);

create table public.followup_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences(id) on delete cascade,
  step_index integer not null,
  delay_hours integer not null default 0 check (delay_hours >= 0),
  channel text not null check (channel in ('whatsapp','email','task_reminder')),
  template_id uuid,
  only_score_categories text[] not null default '{}',
  unique (sequence_id, step_index)
);

create table public.followup_enrollments (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  current_step_index integer not null default 0,
  enrolled_at timestamptz not null default now(),
  next_step_due_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','completed','stopped')),
  enrolled_score_category text not null default 'unscored',
  stop_reason text,
  created_at timestamptz not null default now()
);
-- At most one ACTIVE enrollment per (sequence, lead).
create unique index uniq_active_enrollment on public.followup_enrollments (tenant_id, sequence_id, lead_id)
  where status = 'active';

create table public.followup_step_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null references public.followup_enrollments(id) on delete cascade,
  step_index integer not null,
  outcome text not null check (outcome in ('send','advance_skip','defer_quiet_hours','wait','stop')),
  stop_reason text,
  channel text,
  why_sent jsonb,
  -- A follow-up step can never record a real send.
  will_send boolean not null default false check (will_send = false),
  suppressed_reason text,
  created_at timestamptz not null default now()
);
create index idx_followup_step_events_tenant on public.followup_step_events (tenant_id, enrollment_id);

-- ===========================================================================
-- 3. Site visits + (simulation-only) calendar
-- ===========================================================================
create table public.site_visits (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_id uuid references public.profiles(id) on delete set null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  state text not null default 'requested' check (state in (
    'requested','scheduled','confirmed','in_progress','completed','cancelled','no_show','rescheduled')),
  location text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index idx_site_visits_tenant on public.site_visits (tenant_id, agent_id, scheduled_start);

create table public.visit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null references public.site_visits(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table public.visit_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null references public.site_visits(id) on delete cascade,
  attended boolean not null,
  interest_level text check (interest_level in ('high','medium','low')),
  feedback text,
  created_at timestamptz not null default now(),
  unique (visit_id)
);

-- SIMULATION-ONLY calendar: no OAuth tokens / secrets are stored. A connection
-- may never be 'connected' in this phase (mirrors the Phase-7A integration gate).
create table public.calendar_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google','outlook','manual')),
  status text not null default 'disconnected' check (status in ('disconnected','simulated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, agent_id, provider)
);

create table public.calendar_busy_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('visit','calendar')),
  ref_id text,
  block_start timestamptz not null,
  block_end timestamptz not null,
  created_at timestamptz not null default now(),
  check (block_end > block_start)
);
create index idx_calendar_busy_tenant on public.calendar_busy_blocks (tenant_id, agent_id, block_start);

-- ===========================================================================
-- 4. Notifications
-- ===========================================================================
create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on public.notifications (tenant_id, recipient_user_id, created_at desc);

create table public.notification_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  quiet_hours_enabled boolean not null default true,
  muted_kinds text[] not null default '{}',
  unique (tenant_id, user_id)
);

create table public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app','email','push')),
  status text not null default 'pending' check (status in ('pending','delivered','simulated','suppressed','failed')),
  -- External channels are SIMULATED in this phase (no live email/push provider).
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  check (channel = 'in_app' or simulated = true)
);

-- ===========================================================================
-- 5. Permissions
-- ===========================================================================
insert into public.permissions (key) values
  ('automations.read'), ('automations.manage'),
  ('followups.read'), ('followups.manage'),
  ('sitevisits.read'), ('sitevisits.manage'),
  ('notifications.read'), ('notifications.manage')
on conflict (key) do nothing;

-- ===========================================================================
-- 6. RLS (default-deny; tenant + permission scoped)
-- ===========================================================================
alter table public.automations enable row level security;
alter table public.automation_actions enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_run_actions enable row level security;
alter table public.followup_sequences enable row level security;
alter table public.followup_steps enable row level security;
alter table public.followup_enrollments enable row level security;
alter table public.followup_step_events enable row level security;
alter table public.site_visits enable row level security;
alter table public.visit_events enable row level security;
alter table public.visit_outcomes enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_busy_blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;

-- Automations
create policy automations_sel on public.automations for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('automations.read'));
create policy automations_ins on public.automations for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));
create policy automations_upd on public.automations for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));
create policy automations_del on public.automations for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));

create policy automation_actions_sel on public.automation_actions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('automations.read'));
create policy automation_actions_ins on public.automation_actions for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));
create policy automation_actions_upd on public.automation_actions for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));
create policy automation_actions_del on public.automation_actions for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('automations.manage'));

create policy automation_runs_sel on public.automation_runs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('automations.read'));
create policy automation_run_actions_sel on public.automation_run_actions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('automations.read'));

-- Follow-up sequences
create policy fs_sel on public.followup_sequences for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('followups.read'));
create policy fs_ins on public.followup_sequences for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fs_upd on public.followup_sequences for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fs_del on public.followup_sequences for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));

create policy fst_sel on public.followup_steps for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('followups.read'));
create policy fst_ins on public.followup_steps for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fst_upd on public.followup_steps for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fst_del on public.followup_steps for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));

create policy fe_sel on public.followup_enrollments for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('followups.read'));
create policy fe_ins on public.followup_enrollments for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fe_upd on public.followup_enrollments for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('followups.manage'));
create policy fse_sel on public.followup_step_events for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('followups.read'));

-- Site visits
create policy sv_sel on public.site_visits for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('sitevisits.read'));
create policy sv_ins on public.site_visits for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));
create policy sv_upd on public.site_visits for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));
create policy ve_sel on public.visit_events for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('sitevisits.read'));
create policy ve_ins on public.visit_events for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));
create policy vo_sel on public.visit_outcomes for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('sitevisits.read'));
create policy vo_ins on public.visit_outcomes for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));

create policy cc_sel on public.calendar_connections for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('sitevisits.read'));
create policy cc_ins on public.calendar_connections for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));
create policy cc_upd on public.calendar_connections for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));
create policy cbb_sel on public.calendar_busy_blocks for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('sitevisits.read'));
create policy cbb_ins on public.calendar_busy_blocks for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('sitevisits.manage'));

-- Notifications: a user reads their OWN notifications; preferences are own-row.
create policy notif_sel on public.notifications for select
  using (tenant_id = public.current_tenant_id() and recipient_user_id = auth.uid());
create policy notif_upd on public.notifications for update
  using (tenant_id = public.current_tenant_id() and recipient_user_id = auth.uid());
create policy np_sel on public.notification_preferences for select
  using (tenant_id = public.current_tenant_id() and user_id = auth.uid());
create policy np_ins on public.notification_preferences for insert
  with check (tenant_id = public.current_tenant_id() and user_id = auth.uid());
create policy np_upd on public.notification_preferences for update
  using (tenant_id = public.current_tenant_id() and user_id = auth.uid());
create policy nd_sel on public.notification_deliveries for select
  using (tenant_id = public.current_tenant_id() and exists (
    select 1 from public.notifications n
    where n.id = notification_id and n.recipient_user_id = auth.uid()));

-- ===========================================================================
-- 7. Audit actions
-- ===========================================================================
insert into public.audit_actions (key, category, description, is_security) values
  ('automation.created', 'configuration', 'Automation created', true),
  ('automation.updated', 'configuration', 'Automation updated', true),
  ('automation.run', 'configuration', 'Automation evaluated for an event', false),
  ('automation.action_executed', 'configuration', 'Automation internal action executed', false),
  ('automation.action_suppressed', 'configuration', 'Automation customer-send action suppressed (not sent)', false),
  ('followup.sequence.updated', 'configuration', 'Follow-up sequence updated', true),
  ('followup.enrolled', 'configuration', 'Lead enrolled in a follow-up sequence', false),
  ('followup.unenrolled', 'configuration', 'Lead unenrolled / sequence stopped', false),
  ('followup.step.suppressed', 'configuration', 'Follow-up step recorded as suppressed (not sent)', false),
  ('visit.scheduled', 'configuration', 'Site visit scheduled', false),
  ('visit.transitioned', 'configuration', 'Site visit state transitioned', false),
  ('visit.outcome_recorded', 'configuration', 'Site visit outcome recorded', false),
  ('notification.created', 'configuration', 'Notification created', false)
on conflict (key) do nothing;

-- ===========================================================================
-- 8. Per-tenant grants + provisioning
-- ===========================================================================
create or replace function public.grant_phase8_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug in ('client_admin') then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'automations.read','automations.manage','followups.read','followups.manage',
          'sitevisits.read','sitevisits.manage','notifications.read','notifications.manage'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'automations.read','automations.manage','followups.read','followups.manage',
          'sitevisits.read','sitevisits.manage','notifications.read'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'automations.read','followups.read','sitevisits.read','sitevisits.manage','notifications.read'
        ]) k on conflict do nothing;
    elsif r.slug = 'marketing_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'automations.read','followups.read','notifications.read'
        ]) k on conflict do nothing;
    elsif r.slug = 'project_maintenance' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['sitevisits.read','notifications.read']) k on conflict do nothing;
    elsif r.slug = 'viewer' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'automations.read','followups.read','sitevisits.read','notifications.read'
        ]) k on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  perform public.seed_default_pipeline(new.id);
  perform public.seed_default_qualification_fields(new.id);
  perform public.grant_phase41_conversation_perms(new.id);
  perform public.grant_phase5a_ai_perms(new.id);
  perform public.provision_phase5a_ai(new.id);
  perform public.grant_phase5b0_responder_perms(new.id);
  perform public.grant_phase6a_scoring_perms(new.id);
  perform public.seed_phase6a_scoring(new.id);
  perform public.grant_phase6b_matching_perms(new.id);
  perform public.seed_phase6b_matching(new.id);
  perform public.grant_phase7a_integration_perms(new.id);
  perform public.seed_phase7a_integration(new.id);
  perform public.grant_demo_data_perms(new.id);
  perform public.grant_phase8_perms(new.id);
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase8_perms(t.id);
  end loop;
end $$;
