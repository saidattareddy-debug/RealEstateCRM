-- =====================================================================
-- Phase 4 — Conversations
-- Message/conversation model, human takeover (pauses the future AI
-- responder), conversation summaries, website chat widget config, and the
-- consent / do-not-contact (DNC) model.
--
-- Notes:
--  * AI answering is Phase 5; here conversations carry an `ai_active` flag
--    that the future responder must respect. Takeover sets it false.
--  * Supabase Realtime is the production live-inbox mechanism (deferred —
--    needs a live project); the model and APIs are complete now.
--  * RLS mirrors the lead model: `conversations.read.private` sees all
--    tenant conversations; `conversations.read.assigned` sees only the
--    agent's own (assigned conversation or assigned lead). The Project
--    Data & Maintenance role has neither and is therefore denied.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.conversation_channel as enum ('website_chat', 'whatsapp', 'email', 'voice');
create type public.conversation_status as enum ('open', 'snoozed', 'closed');
create type public.message_direction as enum ('inbound', 'outbound', 'internal');
create type public.message_sender as enum ('lead', 'agent', 'ai', 'system');
create type public.message_status as enum (
  'received', 'queued', 'sent', 'delivered', 'read', 'failed'
);
create type public.consent_channel as enum ('whatsapp', 'email', 'sms', 'call', 'any');
create type public.consent_status as enum ('granted', 'revoked', 'do_not_contact');
create type public.conversation_event_type as enum (
  'takeover', 'resume', 'transfer', 'close', 'reopen', 'assign'
);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  channel public.conversation_channel not null default 'website_chat',
  status public.conversation_status not null default 'open',
  subject text,
  language text,
  -- The future AI responder must not answer while this is false.
  ai_active boolean not null default true,
  human_takeover_by uuid references public.profiles(id) on delete set null,
  human_takeover_at timestamptz,
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  widget_id uuid,
  -- Per-channel external thread / session key (widget session, WA thread …).
  external_thread_id text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  needs_response boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_tenant on public.conversations (tenant_id, status, last_message_at desc);
create index idx_conversations_lead on public.conversations (lead_id);
create index idx_conversations_agent on public.conversations (assigned_agent_id) where assigned_agent_id is not null;
-- One conversation per external thread per tenant+channel (idempotent session).
create unique index idx_conversations_thread
  on public.conversations (tenant_id, channel, external_thread_id)
  where external_thread_id is not null;

create trigger trg_conversations_updated before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table public.conversation_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  direction public.message_direction not null,
  sender public.message_sender not null,
  sender_id uuid references public.profiles(id) on delete set null,
  body text,
  language text,
  status public.message_status not null default 'received',
  -- Provider/widget message id — enables idempotent inbound delivery.
  external_message_id text,
  media jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on public.conversation_messages (conversation_id, created_at);
create index idx_messages_tenant on public.conversation_messages (tenant_id, created_at desc);
-- Idempotent inbound: one row per (tenant, conversation, external id).
create unique index idx_messages_external
  on public.conversation_messages (tenant_id, conversation_id, external_message_id)
  where external_message_id is not null;

-- ---------------------------------------------------------------------------
-- Participants (agents watching / owning a conversation)
-- ---------------------------------------------------------------------------
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'observer' check (role in ('owner', 'observer')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Summaries (deterministic now; AI-generated in Phase 5)
-- ---------------------------------------------------------------------------
create table public.conversation_summaries (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  summary text not null,
  unanswered_question text,
  recommended_next_action text,
  message_count integer not null default 0,
  source text not null default 'deterministic' check (source in ('deterministic', 'ai')),
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_summaries_conversation on public.conversation_summaries (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Conversation events (takeover / resume / transfer / close … audit trail)
-- ---------------------------------------------------------------------------
create table public.conversation_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  type public.conversation_event_type not null,
  actor_id uuid references public.profiles(id) on delete set null,
  from_agent_id uuid references public.profiles(id) on delete set null,
  to_agent_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_conv_events_conversation on public.conversation_events (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Website chat widget configuration
-- ---------------------------------------------------------------------------
create table public.website_chat_widgets (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  project_id uuid references public.projects(id) on delete set null,
  source_id uuid references public.lead_sources(id) on delete set null,
  status public.public_form_status not null default 'draft',
  -- Public embed key (safe to expose); paired secret is hashed only.
  public_key text not null,
  secret_hash text,
  welcome_message text,
  avatar_url text,
  accent_color text,
  position text not null default 'bottom-right',
  allowed_origins text[] not null default '{}',
  enabled_pages text[] not null default '{}',
  initial_questions text[] not null default '{}',
  rate_limit_per_min integer not null default 30 check (rate_limit_per_min > 0),
  consent_required boolean not null default true,
  privacy_notice_version text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (tenant_id, public_key)
);
create index idx_widgets_tenant on public.website_chat_widgets (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Consent / Do-Not-Contact
-- ---------------------------------------------------------------------------
create table public.contact_consents (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  channel public.consent_channel not null default 'any',
  -- Normalised phone (E.164) or lower-cased email when not tied to a lead.
  contact_value text,
  status public.consent_status not null default 'granted',
  source text,
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_consents_lead on public.contact_consents (lead_id);
create unique index idx_consents_unique
  on public.contact_consents (tenant_id, channel, coalesce(lead_id::text, ''), coalesce(contact_value, ''));

create trigger trg_consents_updated before update on public.contact_consents
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.conversations           enable row level security;
alter table public.conversation_messages    enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.conversation_summaries    enable row level security;
alter table public.conversation_events       enable row level security;
alter table public.website_chat_widgets      enable row level security;
alter table public.contact_consents          enable row level security;

-- Conversation visibility: private (all) vs assigned (own conversation/lead).
-- Project Data & Maintenance has neither permission and is denied.
create policy conversations_select on public.conversations for select
  using (
    public.is_active_member(tenant_id) and (
      public.has_raw_permission('conversations.read.private')
      or (
        public.has_raw_permission('conversations.read.assigned')
        and (
          assigned_agent_id = auth.uid()
          or (lead_id is not null and public.current_user_assigned(lead_id))
        )
      )
    )
  );
-- Writes are split per command so a `for all` policy can never widen SELECT.
create policy conversations_insert on public.conversations for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('conversations.reply'));
create policy conversations_update on public.conversations for update
  using (
    tenant_id = public.current_tenant_id() and (
      public.has_permission('conversations.reply')
      or public.has_permission('conversations.takeover')
      or public.has_permission('conversations.transfer')
    )
  )
  with check (tenant_id = public.current_tenant_id());

-- Child tables inherit conversation visibility (subquery is RLS-filtered).
create policy messages_select on public.conversation_messages for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy messages_insert on public.conversation_messages for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('conversations.reply')
    and exists (select 1 from public.conversations c where c.id = conversation_id)
  );

create policy participants_select on public.conversation_participants for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy participants_write on public.conversation_participants for all
  using (
    tenant_id = public.current_tenant_id()
    and public.has_permission('conversations.transfer')
    and exists (select 1 from public.conversations c where c.id = conversation_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('conversations.transfer')
  );

create policy summaries_select on public.conversation_summaries for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy summaries_insert on public.conversation_summaries for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('conversations.reply')
    and exists (select 1 from public.conversations c where c.id = conversation_id)
  );

create policy conv_events_select on public.conversation_events for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy conv_events_insert on public.conversation_events for insert
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.has_permission('conversations.takeover')
      or public.has_permission('conversations.transfer')
      or public.has_permission('conversations.reply')
    )
    and exists (select 1 from public.conversations c where c.id = conversation_id)
  );

-- Widget config: managed by org admins; not exposed to the browser via RLS
-- (the public embed endpoint reads it server-side with the service role).
create policy widgets_select on public.website_chat_widgets for select
  using (public.is_active_member(tenant_id) and public.has_permission('settings.org.manage'));
create policy widgets_write on public.website_chat_widgets for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('settings.org.manage'));

-- Consent / DNC: readable by lead-area members; written with leads.update.
create policy consents_select on public.contact_consents for select
  using (public.is_active_member(tenant_id) and public.has_permission('leads.read.assigned'));
create policy consents_write on public.contact_consents for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('leads.update'));

-- ===========================================================================
-- Audit catalogue (mirrors packages/validation/src/audit.ts)
-- ===========================================================================
insert into public.audit_actions (key, category, description, is_security) values
  ('conversation.reply',    'configuration',  'Agent sent an outbound message',              false),
  ('conversation.takeover', 'configuration',  'Human took over a conversation (AI paused)',  false),
  ('conversation.resume',   'configuration',  'AI handling resumed on a conversation',       false),
  ('conversation.transfer', 'configuration',  'Conversation transferred to another agent',   false),
  ('conversation.close',    'configuration',  'Conversation closed or reopened',             false),
  ('conversation.summary',  'configuration',  'Conversation summary generated',              false),
  ('consent.update',        'access_control', 'Contact consent / do-not-contact updated',    true),
  ('widget.config.update',  'configuration',  'Website chat widget configured',              false)
on conflict (key) do nothing;
