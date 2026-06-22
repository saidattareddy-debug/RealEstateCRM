-- =====================================================================
-- Phase 5B.0 — runtime enablement, two-person activation, and a transactional
-- outbox for a FUTURE live responder. Forward-only. RECORD-ONLY:
--   * There is no active `live` runtime mode (strongest is `live_candidate`).
--   * The send-candidate status set has NO delivered/sent value — the database
--     cannot record a customer-delivered automatic message in this phase.
--   * `ai_runs` (mode <> 'automatic') and `ai_responder_decisions`
--     (outcome <> 'deliver') CHECKs are NOT widened here.
-- Enabling sending additionally requires the compile-time
-- `LIVE_SEND_MASTER_SWITCH = false` to be flipped in a separate 5B.1 PR — DB
-- configuration alone can never enable a send.
-- =====================================================================

-- ---- Enums -----------------------------------------------------------------
create type public.responder_runtime_mode as enum (
  'disabled', 'shadow', 'copilot', 'live_candidate'
); -- NOTE: intentionally no active 'live' value in Phase 5B.0.

create type public.responder_activation_status as enum (
  'pending', 'approved', 'rejected', 'expired'
);

create type public.responder_approval_role as enum ('product', 'engineering', 'legal');

create type public.send_candidate_status as enum (
  'pending', 'revalidating', 'suppressed', 'simulated', 'cancelled', 'dead_letter'
); -- NOTE: no 'delivered'/'sent' — a customer send cannot be recorded here.

create type public.send_attempt_status as enum (
  'accepted', 'failed', 'timeout', 'simulated', 'manual_review'
);

-- ---- 1. Runtime enablement (per tenant / channel / optional project) -------
create table public.responder_channel_settings (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel public.conversation_channel not null,
  project_id uuid references public.projects(id) on delete cascade,
  mode public.responder_runtime_mode not null default 'disabled',
  enabled_by uuid references public.profiles(id) on delete set null,
  enabled_at timestamptz,
  approval_reference text,
  max_sends_per_hour integer not null default 0 check (max_sends_per_hour >= 0),
  max_sends_per_day integer not null default 0 check (max_sends_per_day >= 0),
  allowed_languages text[] not null default '{}',
  allowed_categories text[] not null default '{}',
  blocked_categories text[] not null default '{}',
  rollout_percentage integer not null default 0
    check (rollout_percentage between 0 and 100),
  effective_start timestamptz,
  effective_expiry timestamptz,
  kill_switch_active boolean not null default false,
  kill_switch_reason text,
  last_disabled_by uuid references public.profiles(id) on delete set null,
  last_disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, project_id)
);
create index idx_responder_channel_settings on public.responder_channel_settings (tenant_id, channel);

-- ---- 2. Two-person activation workflow -------------------------------------
create table public.responder_activation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel public.conversation_channel not null,
  project_id uuid references public.projects(id) on delete cascade,
  requested_mode public.responder_runtime_mode not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.responder_activation_status not null default 'pending',
  summary text,
  external_reference text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index idx_responder_activation_requests on public.responder_activation_requests (tenant_id, status);

create table public.responder_activation_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.responder_activation_requests(id) on delete cascade,
  approval_role public.responder_approval_role not null,
  approver_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject')),
  safe_summary text,
  external_reference text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  -- A person may appear at most once per request (no self-double-approval).
  unique (request_id, approver_id)
);
-- The requester may never approve their own request (two-person integrity).
create or replace function public.responder_approval_requester_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_requester uuid;
begin
  select requested_by into v_requester
    from public.responder_activation_requests where id = new.request_id;
  if v_requester is not null and v_requester = new.approver_id then
    raise exception 'requester_cannot_approve_own_request';
  end if;
  return new;
end $$;
create trigger trg_responder_approval_requester_guard
  before insert on public.responder_activation_approvals
  for each row execute function public.responder_approval_requester_guard();

-- ---- 3. Transactional outbox (delivery candidates) -------------------------
create table public.ai_send_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  decision_id uuid references public.ai_responder_decisions(id) on delete set null,
  run_id uuid references public.ai_runs(id) on delete set null,
  channel public.conversation_channel not null,
  -- One inbound customer message → at most one successful automatic send.
  idempotency_key text not null,
  status public.send_candidate_status not null default 'pending',
  suppressed_reason text,
  cancellation_reason text,
  -- Internal only; never delivered to a customer in this phase.
  candidate_body text,
  prompt_version text,
  knowledge_snapshot_id text,
  grounding_version text,
  conversation_state_version integer,
  triggering_inbound_message_id uuid,
  latest_message_id_at_creation uuid,
  simulated_result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  processed_at timestamptz,
  unique (tenant_id, idempotency_key)
);
create index idx_ai_send_candidates_scope on public.ai_send_candidates (tenant_id, status, created_at desc);

create table public.ai_send_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid not null references public.ai_send_candidates(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  status public.send_attempt_status not null,
  provider_message_ref text,
  error_code text,
  error_summary text,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (candidate_id, attempt_no)
);

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key) values
  ('responder.activation.request'),
  ('responder.activation.approve'),
  ('responder.channel.manage'),
  ('responder.killswitch.manage')
on conflict (key) do nothing;

-- ---- RLS -------------------------------------------------------------------
alter table public.responder_channel_settings enable row level security;
alter table public.responder_activation_requests enable row level security;
alter table public.responder_activation_approvals enable row level security;
alter table public.ai_send_candidates enable row level security;
alter table public.ai_send_attempts enable row level security;

-- Channel settings: read with ai.runs.read; write with responder.channel.manage;
-- the kill switch may also be toggled with responder.killswitch.manage.
create policy rcs_sel on public.responder_channel_settings for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read'));
create policy rcs_ins on public.responder_channel_settings for insert
  with check (tenant_id = public.current_tenant_id()
    and public.has_permission('responder.channel.manage'));
create policy rcs_upd on public.responder_channel_settings for update
  using (tenant_id = public.current_tenant_id()
    and (public.has_permission('responder.channel.manage')
         or public.has_permission('responder.killswitch.manage')));

create policy rar_sel on public.responder_activation_requests for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read'));
create policy rar_ins on public.responder_activation_requests for insert
  with check (tenant_id = public.current_tenant_id()
    and public.has_permission('responder.activation.request'));
create policy rar_upd on public.responder_activation_requests for update
  using (tenant_id = public.current_tenant_id()
    and public.has_permission('responder.activation.approve'));

create policy raa_sel on public.responder_activation_approvals for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read'));
create policy raa_ins on public.responder_activation_approvals for insert
  with check (tenant_id = public.current_tenant_id()
    and public.has_permission('responder.activation.approve'));

-- Outbox candidates + attempts: read with ai.runs.read. Writes are performed by
-- the server worker via the service role (RLS-exempt); no broad insert policy.
create policy asc_sel on public.ai_send_candidates for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read'));
create policy asa_sel on public.ai_send_attempts for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id)
    and public.has_permission('ai.runs.read'));

-- ---- Audit actions ---------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('responder.activation.requested', 'configuration', 'Responder live-activation requested', true),
  ('responder.activation.approved', 'configuration', 'Responder live-activation approval recorded', true),
  ('responder.channel.updated', 'configuration', 'Responder channel runtime settings updated', true),
  ('responder.killswitch.activated', 'configuration', 'Responder kill switch activated', true),
  ('responder.candidate.simulated', 'configuration', 'Responder delivery candidate simulated (not sent)', false),
  ('responder.candidate.suppressed', 'configuration', 'Responder delivery candidate suppressed', false)
on conflict (key) do nothing;

-- ---- Per-tenant grants (forward-only) --------------------------------------
create or replace function public.grant_phase5b0_responder_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'responder.activation.request','responder.activation.approve',
          'responder.channel.manage','responder.killswitch.manage'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      -- A manager may request activation + trip the kill switch, but not approve.
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'responder.activation.request','responder.killswitch.manage'
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
  return new;
end; $$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase5b0_responder_perms(t.id);
  end loop;
end $$;
