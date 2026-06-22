-- =====================================================================
-- Phase 4.1 — AI Safety & Inbox Completion
-- Message lifecycle, inbox operations, website-session security and the
-- data model required BEFORE an automated responder can be introduced.
--
-- No AI is executed here. Conversations gain an `operating_mode`
-- ('human' | 'paused' | 'ai'); 'ai' is never reachable until Phase 5 and
-- the central guard `canExecuteAutomatedReply` (packages/domain) always
-- denies until a production responder is installed.
--
-- New enums + columns are additive (no ALTER TYPE ADD VALUE, which cannot
-- run inside a transaction). `lifecycle` supersedes the 0011 `status`
-- column for state that must gate AI (paused/resolved/spam/archived).
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.conversation_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.conversation_operating_mode as enum ('human', 'paused', 'ai');
create type public.conversation_lifecycle as enum (
  'open', 'paused', 'resolved', 'closed', 'spam', 'archived'
);
create type public.waiting_on_state as enum ('agent', 'lead', 'system', 'none');
create type public.assignment_source as enum (
  'manual', 'rule', 'round_robin', 'lead_owner', 'system'
);
create type public.message_delivery_status as enum (
  'received', 'pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'
);
create type public.note_visibility as enum ('assigned_agent', 'team', 'manager_only');
create type public.dnc_reason as enum (
  'user_opt_out', 'wrong_number', 'complaint', 'legal_request', 'admin_action', 'other'
);
create type public.dnc_scope as enum ('lead', 'contact_value', 'tenant');
create type public.consent_event_type as enum (
  'privacy_accepted',
  'contact_consent_granted',
  'contact_consent_withdrawn',
  'marketing_consent_granted',
  'marketing_consent_withdrawn',
  'preference_updated'
);
create type public.conversation_summary_type as enum ('manual', 'system_digest', 'ai_generated');
create type public.attachment_availability as enum ('available', 'unavailable', 'external', 'pending');
create type public.attachment_scan_status as enum ('pending', 'clean', 'infected', 'skipped', 'unavailable');
create type public.website_session_status as enum ('active', 'expired', 'rotated', 'ended');

-- ---------------------------------------------------------------------------
-- Conversation columns (additive). `lifecycle` is the AI-gating state.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column priority public.conversation_priority not null default 'normal',
  add column operating_mode public.conversation_operating_mode not null default 'human',
  add column lifecycle public.conversation_lifecycle not null default 'open',
  add column waiting_on public.waiting_on_state not null default 'none',
  add column owner_locked boolean not null default false,
  add column first_response_at timestamptz,
  add column first_response_due_at timestamptz;

-- Map existing 0011 status into lifecycle (open/snoozed→paused/closed).
update public.conversations set lifecycle =
  case status when 'closed' then 'closed'::public.conversation_lifecycle
              when 'snoozed' then 'paused'::public.conversation_lifecycle
              else 'open'::public.conversation_lifecycle end;

-- Redaction marker on messages.
alter table public.conversation_messages
  add column redacted boolean not null default false,
  add column redacted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Assignment + transfer history
-- ---------------------------------------------------------------------------
create table public.conversation_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id uuid references public.profiles(id) on delete set null,
  team_id uuid,
  source public.assignment_source not null default 'manual',
  assigned_by uuid references public.profiles(id) on delete set null,
  reason text,
  owner_locked boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active boolean not null default true
);
create index idx_conv_assign on public.conversation_assignments (conversation_id, active);

create table public.conversation_transfer_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  from_agent_id uuid references public.profiles(id) on delete set null,
  to_agent_id uuid references public.profiles(id) on delete set null,
  from_team_id uuid,
  to_team_id uuid,
  source public.assignment_source not null default 'manual',
  reason text,
  initiated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_conv_transfer on public.conversation_transfer_events (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Status + priority history
-- ---------------------------------------------------------------------------
create table public.conversation_status_history (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  previous_value text,
  new_value text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  request_id text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_conv_status_hist on public.conversation_status_history (conversation_id, created_at desc);

create table public.conversation_priority_history (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  previous_value text,
  new_value text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  request_id text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_conv_priority_hist on public.conversation_priority_history (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Read state (per user)
-- ---------------------------------------------------------------------------
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  last_read_message_id uuid references public.conversation_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  unread_count integer not null default 0,
  primary key (conversation_id, profile_id)
);
create index idx_conv_reads_profile on public.conversation_reads (profile_id);

-- ---------------------------------------------------------------------------
-- SLA
-- ---------------------------------------------------------------------------
create table public.conversation_sla_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  project_id uuid references public.projects(id) on delete set null,
  channel public.conversation_channel,
  priority public.conversation_priority,
  first_response_minutes integer not null default 15 check (first_response_minutes > 0),
  next_response_minutes integer not null default 60 check (next_response_minutes > 0),
  working_hours jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_sla_policies_tenant on public.conversation_sla_policies (tenant_id, active);

create table public.conversation_sla_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  policy_id uuid references public.conversation_sla_policies(id) on delete set null,
  kind text not null check (kind in (
    'first_response_due','first_response_met','breach','breach_resolved','paused','resumed'
  )),
  due_at timestamptz,
  occurred_at timestamptz not null default now(),
  paused_reason text,
  created_at timestamptz not null default now()
);
create index idx_sla_events_conv on public.conversation_sla_events (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Message delivery lifecycle
-- ---------------------------------------------------------------------------
create table public.message_delivery_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  status public.message_delivery_status not null,
  failure_code text,
  failure_summary text,
  provider_ref text,
  created_at timestamptz not null default now()
);
create index idx_delivery_message on public.message_delivery_events (message_id, created_at);

-- ---------------------------------------------------------------------------
-- Message ingestion reliability (mirrors the lead ingestion design)
-- ---------------------------------------------------------------------------
create table public.message_ingestion_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  widget_id uuid,
  external_message_id text,
  idempotency_key text not null,
  payload_hash text not null,
  status public.ingestion_status not null default 'received',
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  resulting_message_id uuid references public.conversation_messages(id) on delete set null,
  last_error_code text,
  error_summary text,
  correlation_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key)
);
create unique index idx_msg_ingest_external
  on public.message_ingestion_events (tenant_id, widget_id, external_message_id)
  where external_message_id is not null;

create table public.message_idempotency_keys (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  scope text not null,
  idem_key text not null,
  message_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, scope, idem_key)
);

create table public.message_processing_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingestion_event_id uuid not null references public.message_ingestion_events(id) on delete cascade,
  attempt_no integer not null,
  status public.ingestion_status not null,
  error text,
  created_at timestamptz not null default now()
);

create table public.message_dead_letter_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  origin_id uuid,
  conversation_id uuid references public.conversations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  error text,
  correlation_id text,
  created_at timestamptz not null default now(),
  replayed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Internal notes (never sent to the customer)
-- ---------------------------------------------------------------------------
create table public.conversation_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  visibility public.note_visibility not null default 'team',
  pinned boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conv_notes on public.conversation_notes (conversation_id, created_at desc);
create trigger trg_conv_notes_updated before update on public.conversation_notes
  for each row execute function public.set_updated_at();

create table public.conversation_note_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  note_id uuid not null references public.conversation_notes(id) on delete cascade,
  body text not null,
  edited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Canned replies
-- ---------------------------------------------------------------------------
create table public.canned_reply_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.canned_replies (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.canned_reply_categories(id) on delete set null,
  title text not null,
  body text not null,
  language text,
  project_id uuid references public.projects(id) on delete set null,
  channel public.conversation_channel,
  active boolean not null default true,
  variables jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_canned_tenant on public.canned_replies (tenant_id, active);
create trigger trg_canned_updated before update on public.canned_replies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
create table public.conversation_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color_token text not null default 'forest',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.conversation_tag_assignments (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.conversation_tags(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Consent lifecycle + Do-Not-Contact
-- ---------------------------------------------------------------------------
create table public.consent_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  type public.consent_event_type not null,
  channel public.consent_channel not null default 'any',
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index idx_consent_events_lead on public.consent_events (lead_id, created_at desc);

create table public.do_not_contact_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  contact_value text,
  channel public.consent_channel not null default 'any',
  scope public.dnc_scope not null default 'lead',
  reason public.dnc_reason not null default 'user_opt_out',
  active boolean not null default true,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz not null default now(),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_dnc_lead on public.do_not_contact_entries (lead_id, active);

-- ---------------------------------------------------------------------------
-- Message redaction
-- ---------------------------------------------------------------------------
create table public.message_redaction_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reason text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  original_hash text not null,
  replacement_text text not null default '[redacted]',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Attachment metadata (binary storage NOT connected — metadata only)
-- ---------------------------------------------------------------------------
create table public.message_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  filename text,
  mime_type text,
  size_bytes bigint,
  external_url text,
  provider_media_id text,
  storage_provider text,
  availability public.attachment_availability not null default 'unavailable',
  scan_status public.attachment_scan_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index idx_attachments_message on public.message_attachments (message_id);

-- ---------------------------------------------------------------------------
-- Website chat sessions (signed-token model)
-- ---------------------------------------------------------------------------
create table public.website_chat_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  widget_id uuid not null references public.website_chat_widgets(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  public_session_id text not null,
  token_hash text not null,
  token_version integer not null default 1,
  anonymous_visitor_id text,
  lead_associated_at timestamptz,
  language text,
  project_context uuid,
  page_context text,
  utm jsonb not null default '{}'::jsonb,
  consent_state text,
  status public.website_session_status not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  rotated_at timestamptz,
  unique (tenant_id, public_session_id)
);
create index idx_web_sessions_widget on public.website_chat_sessions (widget_id, status);

-- ---------------------------------------------------------------------------
-- Summary versioning
-- ---------------------------------------------------------------------------
create table public.conversation_summary_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  summary_id uuid references public.conversation_summaries(id) on delete set null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  version integer not null default 1,
  summary_type public.conversation_summary_type not null default 'manual',
  source_message_start uuid,
  source_message_end uuid,
  body text not null,
  model text,
  prompt_version text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  -- Phase 4.1: AI summaries are not permitted, and deterministic/manual
  -- summaries must not carry a model or prompt version.
  constraint summary_type_not_ai check (summary_type <> 'ai_generated'),
  constraint summary_no_model check (model is null and prompt_version is null)
);
create index idx_summary_versions_conv on public.conversation_summary_versions (conversation_id, created_at desc);

-- ===========================================================================
-- Permissions catalogue (new keys)
-- ===========================================================================
insert into public.permissions (key) values
  ('conversations.read.all'),
  ('conversations.read.team'),
  ('conversations.read.metadata'),
  ('conversations.assign'),
  ('conversations.close'),
  ('conversations.reopen'),
  ('conversations.priority.manage'),
  ('conversations.tags.manage'),
  ('conversations.notes.create'),
  ('conversations.notes.manage'),
  ('conversations.ai.resume'),
  ('conversations.export'),
  ('messages.redact'),
  ('canned_replies.manage'),
  ('website_chat.manage'),
  ('website_chat.view_sessions'),
  ('consent.manage'),
  ('dnc.manage')
on conflict (key) do nothing;

-- Grant the Phase 4.1 conversation permissions to a tenant's default roles.
-- Used both to backfill existing tenants and (via on_tenant_created) to keep
-- newly-provisioned tenants correct.
create or replace function public.grant_phase41_conversation_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'conversations.read.all','conversations.read.team','conversations.read.metadata',
          'conversations.assign','conversations.close','conversations.reopen',
          'conversations.priority.manage','conversations.tags.manage','conversations.notes.create',
          'conversations.notes.manage','conversations.ai.resume','conversations.export',
          'messages.redact','canned_replies.manage','website_chat.manage',
          'website_chat.view_sessions','consent.manage','dnc.manage'
        ]) k
        on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'conversations.read.team','conversations.read.metadata','conversations.assign',
          'conversations.close','conversations.reopen','conversations.priority.manage',
          'conversations.tags.manage','conversations.notes.create','conversations.notes.manage',
          'conversations.ai.resume','conversations.export','messages.redact',
          'canned_replies.manage','website_chat.manage','website_chat.view_sessions',
          'consent.manage','dnc.manage'
        ]) k
        on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      -- NOTE: agents do NOT get conversations.read.metadata — that scope sees
      -- ALL tenant conversations and would break assigned-only isolation.
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'conversations.close','conversations.reopen',
          'conversations.notes.create','conversations.ai.resume','conversations.tags.manage'
        ]) k
        on conflict do nothing;
    elsif r.slug = 'marketing_manager' then
      insert into public.role_permissions (role_id, permission_key)
        values (r.id, 'conversations.read.metadata')
        on conflict do nothing;
    end if;
  end loop;
end $$;

-- New tenants: run the grant after the base roles are seeded. (Preserves the
-- 0010 behaviour — branding/settings/roles/pipeline/qualification.)
create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_branding (tenant_id) values (new.id);
  insert into public.tenant_settings (tenant_id) values (new.id);
  perform public.seed_default_roles(new.id);
  perform public.seed_default_pipeline(new.id);
  perform public.seed_default_qualification_fields(new.id);
  perform public.grant_phase41_conversation_perms(new.id);
  return new;
end; $$;

-- Backfill any tenants that already exist at migration time.
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase41_conversation_perms(t.id);
  end loop;
end $$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.conversation_assignments        enable row level security;
alter table public.conversation_transfer_events     enable row level security;
alter table public.conversation_status_history      enable row level security;
alter table public.conversation_priority_history    enable row level security;
alter table public.conversation_reads               enable row level security;
alter table public.conversation_sla_policies        enable row level security;
alter table public.conversation_sla_events          enable row level security;
alter table public.message_delivery_events          enable row level security;
alter table public.message_ingestion_events         enable row level security;
alter table public.message_idempotency_keys         enable row level security;
alter table public.message_processing_attempts      enable row level security;
alter table public.message_dead_letter_events       enable row level security;
alter table public.conversation_notes               enable row level security;
alter table public.conversation_note_versions       enable row level security;
alter table public.canned_reply_categories          enable row level security;
alter table public.canned_replies                   enable row level security;
alter table public.conversation_tags                enable row level security;
alter table public.conversation_tag_assignments     enable row level security;
alter table public.consent_events                   enable row level security;
alter table public.do_not_contact_entries           enable row level security;
alter table public.message_redaction_events         enable row level security;
alter table public.message_attachments              enable row level security;
alter table public.website_chat_sessions            enable row level security;
alter table public.conversation_summary_versions    enable row level security;

-- Helper predicate is inlined: a conversation is visible iff the 0011
-- conversations_select policy lets the caller see it (RLS-filtered subquery).
-- Child SELECTs inherit; writes are split per-command and never `for all`.

-- Assignment / transfer / status / priority history (read = conversation visible)
create policy conv_assign_sel on public.conversation_assignments for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_assign_ins on public.conversation_assignments for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.assign')
    and exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_assign_upd on public.conversation_assignments for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('conversations.assign'));

create policy conv_transfer_sel on public.conversation_transfer_events for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_transfer_ins on public.conversation_transfer_events for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.transfer')
    and exists (select 1 from public.conversations c where c.id = conversation_id));

create policy conv_status_hist_sel on public.conversation_status_history for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_status_hist_ins on public.conversation_status_history for insert
  with check (tenant_id = public.current_tenant_id()
    and (public.has_permission('conversations.close') or public.has_permission('conversations.reopen')
         or public.has_permission('conversations.reply'))
    and exists (select 1 from public.conversations c where c.id = conversation_id));

create policy conv_priority_hist_sel on public.conversation_priority_history for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_priority_hist_ins on public.conversation_priority_history for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.priority.manage')
    and exists (select 1 from public.conversations c where c.id = conversation_id));

-- Read state: a user manages ONLY their own row, and only on a visible conversation.
create policy conv_reads_sel on public.conversation_reads for select
  using (profile_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_reads_write on public.conversation_reads for all
  using (profile_id = auth.uid() and tenant_id = public.current_tenant_id())
  with check (profile_id = auth.uid() and tenant_id = public.current_tenant_id()
    and exists (select 1 from public.conversations c where c.id = conversation_id));

-- SLA policies: org config; events inherit conversation visibility.
create policy sla_policies_sel on public.conversation_sla_policies for select
  using (public.is_active_member(tenant_id));
create policy sla_policies_write on public.conversation_sla_policies for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));
create policy sla_events_sel on public.conversation_sla_events for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

-- Delivery events inherit conversation visibility (writes are server-side).
create policy delivery_sel on public.message_delivery_events for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

-- Message ingestion / idempotency / attempts / DLQ: ops visibility.
create policy msg_ingest_sel on public.message_ingestion_events for select
  using (public.is_active_member(tenant_id) and public.has_permission('settings.audit.read'));
create policy msg_attempts_sel on public.message_processing_attempts for select
  using (public.is_active_member(tenant_id) and public.has_permission('settings.audit.read'));
create policy msg_dlq_sel on public.message_dead_letter_events for select
  using (public.is_active_member(tenant_id) and public.has_permission('settings.audit.read'));

-- Internal notes: visibility scope respected; never customer-facing.
create policy conv_notes_sel on public.conversation_notes for select
  using (
    exists (select 1 from public.conversations c where c.id = conversation_id)
    -- Internal notes are content, not metadata: require a content read scope.
    and (
      public.has_raw_permission('conversations.read.all')
      or public.has_raw_permission('conversations.read.team')
      or public.has_raw_permission('conversations.read.private')
      or public.has_raw_permission('conversations.read.assigned')
    )
    and (
      visibility <> 'manager_only'
      or public.has_permission('conversations.notes.manage')
      or author_id = auth.uid()
    )
  );
create policy conv_notes_ins on public.conversation_notes for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.notes.create')
    and exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_notes_upd on public.conversation_notes for update
  using (tenant_id = public.current_tenant_id()
    and (author_id = auth.uid() or public.has_permission('conversations.notes.manage')));
create policy conv_note_versions_sel on public.conversation_note_versions for select
  using (exists (select 1 from public.conversation_notes n where n.id = note_id));
create policy conv_note_versions_ins on public.conversation_note_versions for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.notes.create'));

-- Canned replies + categories
create policy canned_cat_sel on public.canned_reply_categories for select
  using (public.is_active_member(tenant_id));
create policy canned_cat_write on public.canned_reply_categories for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('canned_replies.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('canned_replies.manage'));
create policy canned_sel on public.canned_replies for select
  using (public.is_active_member(tenant_id) and public.has_permission('conversations.reply'));
create policy canned_write on public.canned_replies for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('canned_replies.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('canned_replies.manage'));

-- Tags
create policy conv_tags_sel on public.conversation_tags for select
  using (public.is_active_member(tenant_id));
create policy conv_tags_write on public.conversation_tags for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('conversations.tags.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.tags.manage'));
create policy conv_tag_assign_sel on public.conversation_tag_assignments for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_tag_assign_write on public.conversation_tag_assignments for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('conversations.tags.manage')
    and exists (select 1 from public.conversations c where c.id = conversation_id))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.tags.manage'));

-- Consent lifecycle + DNC
create policy consent_events_sel on public.consent_events for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy consent_events_write on public.consent_events for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('consent.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('consent.manage'));
create policy dnc_sel on public.do_not_contact_entries for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy dnc_write on public.do_not_contact_entries for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('dnc.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('dnc.manage'));

-- Redaction
create policy redaction_sel on public.message_redaction_events for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy redaction_ins on public.message_redaction_events for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('messages.redact')
    and exists (select 1 from public.conversations c where c.id = conversation_id));

-- Attachments inherit conversation visibility.
create policy attachments_sel on public.message_attachments for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

-- Website sessions: viewable with website_chat.view_sessions; public endpoints
-- read server-side via the service role.
create policy web_sessions_sel on public.website_chat_sessions for select
  using (public.is_active_member(tenant_id) and public.has_permission('website_chat.view_sessions'));

-- Summary versions inherit conversation visibility.
create policy summary_versions_sel on public.conversation_summary_versions for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy summary_versions_ins on public.conversation_summary_versions for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.reply')
    and exists (select 1 from public.conversations c where c.id = conversation_id));

-- ===========================================================================
-- Refine 0011 conversation policies for the new read scopes
--   read.all / read.team / read.private / read.metadata  → see all tenant
--     conversations (metadata users see the row but NOT message bodies).
--   read.assigned                                        → only own.
-- ===========================================================================
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select
  using (
    public.is_active_member(tenant_id) and (
      public.has_raw_permission('conversations.read.all')
      or public.has_raw_permission('conversations.read.team')
      or public.has_raw_permission('conversations.read.private')
      or public.has_raw_permission('conversations.read.metadata')
      or (
        public.has_raw_permission('conversations.read.assigned')
        and (
          assigned_agent_id = auth.uid()
          or (lead_id is not null and public.current_user_assigned(lead_id))
        )
      )
    )
  );

-- Messages require a CONTENT read scope (metadata-only users are excluded).
drop policy if exists messages_select on public.conversation_messages;
create policy messages_select on public.conversation_messages for select
  using (
    exists (select 1 from public.conversations c where c.id = conversation_id)
    and (
      public.has_raw_permission('conversations.read.all')
      or public.has_raw_permission('conversations.read.team')
      or public.has_raw_permission('conversations.read.private')
      or public.has_raw_permission('conversations.read.assigned')
    )
  );

-- ===========================================================================
-- Audit catalogue
-- ===========================================================================
insert into public.audit_actions (key, category, description, is_security) values
  ('conversation.assign',        'configuration',  'Conversation assigned',                false),
  ('conversation.status_change', 'configuration',  'Conversation status changed',          false),
  ('conversation.priority_change','configuration', 'Conversation priority changed',        false),
  ('conversation.note',          'configuration',  'Internal note created/edited',         false),
  ('conversation.tag',           'configuration',  'Conversation tag changed',             false),
  ('message.redact',             'access_control', 'Message redacted',                     true),
  ('consent.event',              'access_control', 'Consent event recorded',               true),
  ('dnc.update',                 'access_control', 'Do-not-contact entry changed',         true),
  ('canned_reply.manage',        'configuration',  'Canned reply created/updated',         false),
  ('website_chat.session',       'integration',    'Website chat session lifecycle',       false),
  ('message.ingest',             'integration',    'Inbound message ingested',             false),
  ('message.dead_letter',        'integration',    'Inbound message dead-lettered',        true)
on conflict (key) do nothing;
