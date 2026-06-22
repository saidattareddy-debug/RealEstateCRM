-- =====================================================================
-- Phase 5A — Knowledge, RAG & AI Safety Foundation. Forward-only.
-- Tenant-isolated, project-aware knowledge + AI platform. NO customer-facing
-- AI answering is enabled here; automatic sending stays impossible (enforced in
-- packages/domain/ai-guard). Provider credentials are NEVER stored in plaintext
-- (only an env-var reference). No hidden chain-of-thought is stored.
--
-- Embeddings are stored as jsonb (model-agnostic dimensions); a typed pgvector
-- ANN index is deferred to a live project with a fixed embedding model. Lexical
-- retrieval uses PostgreSQL full-text search (tsvector + GIN).
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.ai_provider_kind as enum ('chat', 'embedding');
create type public.ai_adapter as enum ('mock', 'external');
create type public.ai_operating_level as enum ('disabled', 'shadow', 'copilot', 'automatic');
create type public.knowledge_state as enum (
  'draft','processing','review_required','approved','rejected','superseded','archived','failed'
);
create type public.knowledge_source_type as enum (
  'project_overview','approved_faq','brochure','floor_plan','amenity','location',
  'payment_plan','offer','policy','sales_script','legal_disclaimer','manual',
  'imported_facts','general_guidance'
);
create type public.ai_conflict_status as enum ('open','resolved');
create type public.ai_draft_status as enum ('generated','accepted','edited','discarded');

-- ---------------------------------------------------------------------------
-- 1. Provider / model / policy / usage configuration
-- ---------------------------------------------------------------------------
create table public.ai_provider_configs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind public.ai_provider_kind not null,
  adapter public.ai_adapter not null default 'mock',
  display_name text not null,
  -- Reference to a SERVER-ONLY env var. NEVER the secret itself.
  secret_ref text,
  base_url text,
  active boolean not null default true,
  -- External providers are unavailable until a credential is configured.
  available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (secret_ref is null or secret_ref !~ '\s'),
  check (adapter = 'mock' or available = false or secret_ref is not null)
);
create index idx_ai_provider_tenant on public.ai_provider_configs (tenant_id, kind, active);
create trigger trg_ai_provider_updated before update on public.ai_provider_configs
  for each row execute function public.set_updated_at();

create table public.ai_model_configs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_config_id uuid not null references public.ai_provider_configs(id) on delete cascade,
  model_name text not null,
  max_input_tokens integer not null default 8000 check (max_input_tokens > 0),
  max_output_tokens integer not null default 1500 check (max_output_tokens > 0),
  temperature numeric(3,2) not null default 0.20 check (temperature >= 0 and temperature <= 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_config_id, model_name)
);
create index idx_ai_model_tenant on public.ai_model_configs (tenant_id, active);

create table public.embedding_model_configs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_config_id uuid not null references public.ai_provider_configs(id) on delete cascade,
  model_name text not null,
  dimensions integer not null check (dimensions > 0 and dimensions <= 8192),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_config_id, model_name)
);
create index idx_embed_model_tenant on public.embedding_model_configs (tenant_id, active);

create table public.ai_feature_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  operating_level public.ai_operating_level not null default 'disabled',
  general_answers_enabled boolean not null default false,
  english_fallback_allowed boolean not null default true,
  shadow_sample_rate numeric(4,3) not null default 0 check (shadow_sample_rate >= 0 and shadow_sample_rate <= 1),
  copilot_enabled boolean not null default false,
  language_policy jsonb not null default '{}'::jsonb,
  escalation_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, project_id)
);
create trigger trg_ai_policy_updated before update on public.ai_feature_policies
  for each row execute function public.set_updated_at();

create table public.ai_usage_limits (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  daily_token_limit integer not null default 200000 check (daily_token_limit >= 0),
  monthly_token_limit integer not null default 4000000 check (monthly_token_limit >= 0),
  per_conversation_token_limit integer not null default 20000 check (per_conversation_token_limit >= 0),
  per_request_input_limit integer not null default 8000 check (per_request_input_limit >= 0),
  per_request_output_limit integer not null default 1500 check (per_request_output_limit >= 0),
  retrieval_result_limit integer not null default 8 check (retrieval_result_limit >= 0),
  tool_call_limit integer not null default 4 check (tool_call_limit >= 0),
  max_retries integer not null default 2 check (max_retries >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
create trigger trg_ai_usage_updated before update on public.ai_usage_limits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Prompt management (versioned)
-- ---------------------------------------------------------------------------
create table public.ai_prompts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table public.ai_prompt_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prompt_id uuid not null references public.ai_prompts(id) on delete cascade,
  version integer not null check (version > 0),
  body text not null,
  change_summary text,
  active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (prompt_id, version)
);
create index idx_prompt_versions on public.ai_prompt_versions (prompt_id, active);

create table public.ai_prompt_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prompt_id uuid not null references public.ai_prompts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  channel public.conversation_channel,
  language text,
  active_version_id uuid references public.ai_prompt_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, prompt_id, project_id, channel, language)
);

-- ---------------------------------------------------------------------------
-- 3. Knowledge management
-- ---------------------------------------------------------------------------
create table public.knowledge_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  source_type public.knowledge_source_type not null,
  title text not null,
  language text not null default 'en',
  trust_priority integer not null default 50 check (trust_priority between 0 and 100),
  owner_id uuid references public.profiles(id) on delete set null,
  state public.knowledge_state not null default 'draft',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  superseded_by uuid references public.knowledge_sources(id) on delete set null,
  effective_at timestamptz,
  expires_at timestamptz,
  last_verified_at timestamptz,
  checksum text,
  extraction_status text not null default 'pending',
  machine_translated boolean not null default false,
  notes text,
  -- Retention / redaction controls.
  retention_until timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Approval-state integrity: approved rows must carry approver + time.
  check (state <> 'approved' or (approved_by is not null and approved_at is not null))
);
create index idx_knowledge_sources_scope
  on public.knowledge_sources (tenant_id, project_id, state);
create index idx_knowledge_sources_type on public.knowledge_sources (tenant_id, source_type);
create trigger trg_knowledge_sources_updated before update on public.knowledge_sources
  for each row execute function public.set_updated_at();

create table public.knowledge_source_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  version integer not null check (version > 0),
  state public.knowledge_state not null default 'draft',
  checksum text,
  change_summary text,
  approval_reason text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_id, version)
);
create index idx_knowledge_source_versions on public.knowledge_source_versions (source_id, version);

create table public.knowledge_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  language text not null default 'en',
  created_at timestamptz not null default now()
);
create index idx_knowledge_documents_source on public.knowledge_documents (source_id);

create table public.knowledge_document_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  source_version_id uuid references public.knowledge_source_versions(id) on delete set null,
  version integer not null check (version > 0),
  -- Extracted/normalized TEXT only (never temporary file-system paths).
  extracted_text text,
  normalized_text text,
  checksum text,
  injection_flagged boolean not null default false,
  injection_categories text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table public.knowledge_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  source_version_id uuid references public.knowledge_source_versions(id) on delete set null,
  document_version_id uuid references public.knowledge_document_versions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  heading text,
  language text not null default 'en',
  char_start integer not null default 0,
  char_end integer not null default 0,
  token_estimate integer not null default 0,
  trust_priority integer not null default 50,
  effective_at timestamptz,
  expires_at timestamptz,
  state public.knowledge_state not null default 'draft',
  checksum text not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index)
);
create index idx_knowledge_chunks_scope
  on public.knowledge_chunks (tenant_id, project_id, state);
create index idx_knowledge_chunks_tsv on public.knowledge_chunks using gin (content_tsv);
-- Partial index: only approved chunks are ever retrieved for answering.
create index idx_knowledge_chunks_approved
  on public.knowledge_chunks (tenant_id, project_id)
  where state = 'approved';

create table public.knowledge_chunk_embeddings (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chunk_id uuid not null references public.knowledge_chunks(id) on delete cascade,
  embedding_model_config_id uuid references public.embedding_model_configs(id) on delete set null,
  dimensions integer not null check (dimensions > 0),
  -- Vector as jsonb array (model-agnostic). pgvector ANN index deferred.
  vector jsonb not null,
  model_version text not null,
  development boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chunk_id, embedding_model_config_id)
);

create table public.knowledge_approval_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  source_version_id uuid references public.knowledge_source_versions(id) on delete set null,
  from_state public.knowledge_state,
  to_state public.knowledge_state not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_knowledge_approval_events on public.knowledge_approval_events (source_id, created_at desc);

create table public.knowledge_conflicts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  conflict_type text not null,
  claim_summary jsonb not null default '[]'::jsonb,
  status public.ai_conflict_status not null default 'open',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text,
  resolved_at timestamptz,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_knowledge_conflicts on public.knowledge_conflicts (tenant_id, status);

create table public.knowledge_ingestion_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid references public.knowledge_sources(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  method text not null,
  status public.ingestion_status not null default 'received',
  idempotency_key text not null,
  payload_hash text,
  correlation_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create table public.knowledge_ingestion_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.knowledge_ingestion_jobs(id) on delete cascade,
  attempt_no integer not null,
  status public.ingestion_status not null,
  error text,
  created_at timestamptz not null default now()
);

create table public.knowledge_ingestion_errors (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid references public.knowledge_ingestion_jobs(id) on delete set null,
  category text not null,
  summary text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. AI execution + evidence (no hidden reasoning, no credentials)
-- ---------------------------------------------------------------------------
create table public.ai_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  mode public.ai_operating_level not null,
  provider_config_id uuid references public.ai_provider_configs(id) on delete set null,
  model_config_id uuid references public.ai_model_configs(id) on delete set null,
  prompt_version_id uuid references public.ai_prompt_versions(id) on delete set null,
  grounding_decision text,
  escalation_category text,
  output_draft text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_micros integer not null default 0,
  latency_ms integer not null default 0,
  failure_category text,
  correlation_id text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  -- Hard invariant: an automatic run can never be recorded as sent in 5A.
  check (mode <> 'automatic')
);
create index idx_ai_runs_scope on public.ai_runs (tenant_id, conversation_id, created_at desc);

create table public.ai_run_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','data')),
  -- System role stores ONLY a prompt-version reference, never the raw prompt.
  prompt_version_id uuid references public.ai_prompt_versions(id) on delete set null,
  content text,
  created_at timestamptz not null default now(),
  check (role <> 'system' or content is null)
);

create table public.ai_retrieval_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  query_text text,
  query_language text,
  lexical_count integer not null default 0,
  vector_count integer not null default 0,
  merged_count integer not null default 0,
  sufficiency numeric(4,3) not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_retrieved_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  retrieval_event_id uuid not null references public.ai_retrieval_events(id) on delete cascade,
  chunk_id uuid references public.knowledge_chunks(id) on delete set null,
  source_id uuid references public.knowledge_sources(id) on delete set null,
  source_version_id uuid references public.knowledge_source_versions(id) on delete set null,
  score numeric(6,4) not null default 0,
  rank integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_tool_calls (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  tool_name text not null,
  args jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  freshness_at timestamptz,
  stale boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.ai_answer_citations (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  claim text not null,
  source_id uuid references public.knowledge_sources(id) on delete set null,
  source_version_id uuid references public.knowledge_source_versions(id) on delete set null,
  chunk_id uuid references public.knowledge_chunks(id) on delete set null,
  tool_call_id uuid references public.ai_tool_calls(id) on delete set null,
  retrieval_score numeric(6,4),
  citation_label text,
  -- Customer-safe description (e.g. "Project brochure") — never an internal id.
  customer_safe_reference text,
  created_at timestamptz not null default now()
);

create table public.ai_grounding_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  decision text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_escalation_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.ai_runs(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  category text not null,
  reason text,
  evidence_state text,
  suggested_action text,
  priority text not null default 'normal',
  status public.ai_conflict_status not null default 'open',
  resolved_at timestamptz,
  resolution text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index idx_ai_escalation_scope on public.ai_escalation_decisions (tenant_id, status);

create table public.ai_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  rating text check (rating in ('up','down','neutral')),
  comment text,
  created_at timestamptz not null default now()
);

-- Agent-facing copilot drafts (§24). NEVER a sent message; never customer-visible.
create table public.ai_copilot_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  run_id uuid references public.ai_runs(id) on delete set null,
  body text not null,
  grounding_decision text,
  escalation_category text,
  citations jsonb not null default '[]'::jsonb,
  status public.ai_draft_status not null default 'generated',
  disposition_by uuid references public.profiles(id) on delete set null,
  disposition_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_ai_copilot_drafts on public.ai_copilot_drafts (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Evaluation
-- ---------------------------------------------------------------------------
create table public.ai_evaluation_datasets (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.ai_evaluation_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.ai_evaluation_datasets(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  input text not null,
  language text not null default 'en',
  expected_grounding text not null,
  expected_escalation text,
  required_citation_categories text[] not null default '{}'::text[],
  forbidden_claims text[] not null default '{}'::text[],
  expected_tool_calls text[] not null default '{}'::text[],
  draft_allowed boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_ai_eval_cases on public.ai_evaluation_cases (dataset_id);

create table public.ai_evaluation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_id uuid not null references public.ai_evaluation_datasets(id) on delete cascade,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

create table public.ai_evaluation_results (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.ai_evaluation_runs(id) on delete cascade,
  case_id uuid not null references public.ai_evaluation_cases(id) on delete cascade,
  passed boolean not null default false,
  grounding_match boolean not null default false,
  escalation_match boolean not null default false,
  citation_valid boolean not null default false,
  unsupported_claim boolean not null default false,
  isolation_ok boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Permissions (§26)
-- ---------------------------------------------------------------------------
insert into public.permissions (key) values
  ('knowledge.read'),('knowledge.create'),('knowledge.edit'),('knowledge.review'),
  ('knowledge.approve'),('knowledge.archive'),('knowledge.conflicts.resolve'),
  ('ai.settings.read'),('ai.settings.manage'),('ai.providers.manage'),('ai.prompts.manage'),
  ('ai.test_lab.use'),('ai.runs.read'),('ai.feedback.create'),('ai.copilot.use'),
  ('ai.shadow.manage'),('ai.usage.read')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — enable on every new tenant table
-- ---------------------------------------------------------------------------
alter table public.ai_provider_configs        enable row level security;
alter table public.ai_model_configs           enable row level security;
alter table public.embedding_model_configs    enable row level security;
alter table public.ai_feature_policies         enable row level security;
alter table public.ai_usage_limits             enable row level security;
alter table public.ai_prompts                  enable row level security;
alter table public.ai_prompt_versions          enable row level security;
alter table public.ai_prompt_assignments       enable row level security;
alter table public.knowledge_sources           enable row level security;
alter table public.knowledge_source_versions   enable row level security;
alter table public.knowledge_documents         enable row level security;
alter table public.knowledge_document_versions enable row level security;
alter table public.knowledge_chunks            enable row level security;
alter table public.knowledge_chunk_embeddings  enable row level security;
alter table public.knowledge_approval_events   enable row level security;
alter table public.knowledge_conflicts         enable row level security;
alter table public.knowledge_ingestion_jobs    enable row level security;
alter table public.knowledge_ingestion_attempts enable row level security;
alter table public.knowledge_ingestion_errors  enable row level security;
alter table public.ai_runs                     enable row level security;
alter table public.ai_run_messages             enable row level security;
alter table public.ai_retrieval_events         enable row level security;
alter table public.ai_retrieved_chunks         enable row level security;
alter table public.ai_tool_calls               enable row level security;
alter table public.ai_answer_citations         enable row level security;
alter table public.ai_grounding_decisions      enable row level security;
alter table public.ai_escalation_decisions     enable row level security;
alter table public.ai_feedback                 enable row level security;
alter table public.ai_copilot_drafts           enable row level security;
alter table public.ai_evaluation_datasets      enable row level security;
alter table public.ai_evaluation_cases         enable row level security;
alter table public.ai_evaluation_runs          enable row level security;
alter table public.ai_evaluation_results       enable row level security;

-- Helper shorthands (used inline): tenant match + active membership + permission.
-- Provider / model / embedding config: read ai.settings.read, write ai.providers.manage.
create policy ai_provider_sel on public.ai_provider_configs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_provider_ins on public.ai_provider_configs for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy ai_provider_upd on public.ai_provider_configs for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy ai_provider_del on public.ai_provider_configs for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));

create policy ai_model_sel on public.ai_model_configs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_model_ins on public.ai_model_configs for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy ai_model_upd on public.ai_model_configs for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy ai_model_del on public.ai_model_configs for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));

create policy embed_model_sel on public.embedding_model_configs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy embed_model_ins on public.embedding_model_configs for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy embed_model_upd on public.embedding_model_configs for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));
create policy embed_model_del on public.embedding_model_configs for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.providers.manage'));

-- Feature policies + usage limits: read ai.settings.read, write ai.settings.manage.
create policy ai_policy_sel on public.ai_feature_policies for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_policy_ins on public.ai_feature_policies for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'));
create policy ai_policy_upd on public.ai_feature_policies for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'));
create policy ai_policy_del on public.ai_feature_policies for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'));

create policy ai_usage_sel on public.ai_usage_limits for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and (public.has_permission('ai.usage.read') or public.has_permission('ai.settings.read')));
create policy ai_usage_ins on public.ai_usage_limits for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'));
create policy ai_usage_upd on public.ai_usage_limits for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.settings.manage'));

-- Prompts: read ai.settings.read, write ai.prompts.manage.
create policy ai_prompts_sel on public.ai_prompts for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_prompts_w on public.ai_prompts for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'));
create policy ai_prompt_versions_sel on public.ai_prompt_versions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_prompt_versions_w on public.ai_prompt_versions for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'));
create policy ai_prompt_assign_sel on public.ai_prompt_assignments for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.settings.read'));
create policy ai_prompt_assign_w on public.ai_prompt_assignments for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.prompts.manage'));

-- Knowledge: read knowledge.read; writes per lifecycle permission.
create policy ks_sel on public.knowledge_sources for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy ks_ins on public.knowledge_sources for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.create'));
create policy ks_upd on public.knowledge_sources for update
  using (tenant_id = public.current_tenant_id() and (public.has_permission('knowledge.edit') or public.has_permission('knowledge.review') or public.has_permission('knowledge.approve') or public.has_permission('knowledge.archive')))
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('knowledge.edit') or public.has_permission('knowledge.review') or public.has_permission('knowledge.approve') or public.has_permission('knowledge.archive')));
create policy ks_del on public.knowledge_sources for delete
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.archive'));

create policy ksv_sel on public.knowledge_source_versions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy ksv_w on public.knowledge_source_versions for all
  using (tenant_id = public.current_tenant_id() and (public.has_permission('knowledge.edit') or public.has_permission('knowledge.review')))
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('knowledge.edit') or public.has_permission('knowledge.review')));

create policy kd_sel on public.knowledge_documents for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kd_w on public.knowledge_documents for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'));

create policy kdv_sel on public.knowledge_document_versions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kdv_w on public.knowledge_document_versions for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'));

create policy kc_sel on public.knowledge_chunks for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kc_w on public.knowledge_chunks for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'));

create policy kce_sel on public.knowledge_chunk_embeddings for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kce_w on public.knowledge_chunk_embeddings for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'));

create policy kae_sel on public.knowledge_approval_events for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kae_ins on public.knowledge_approval_events for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('knowledge.review') or public.has_permission('knowledge.approve') or public.has_permission('knowledge.archive') or public.has_permission('knowledge.edit')));

create policy kconf_sel on public.knowledge_conflicts for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kconf_ins on public.knowledge_conflicts for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.edit'));
create policy kconf_upd on public.knowledge_conflicts for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.conflicts.resolve'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.conflicts.resolve'));

create policy kij_sel on public.knowledge_ingestion_jobs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kij_w on public.knowledge_ingestion_jobs for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.create'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.create'));
create policy kia_sel on public.knowledge_ingestion_attempts for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kia_ins on public.knowledge_ingestion_attempts for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.create'));
create policy kie_sel on public.knowledge_ingestion_errors for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('knowledge.read'));
create policy kie_ins on public.knowledge_ingestion_errors for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('knowledge.create'));

-- AI runs + evidence: read ai.runs.read; insert by test-lab/copilot users.
create policy air_sel on public.ai_runs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy air_ins on public.ai_runs for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy airm_sel on public.ai_run_messages for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy airm_ins on public.ai_run_messages for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy aire_sel on public.ai_retrieval_events for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aire_ins on public.ai_retrieval_events for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy airc_sel on public.ai_retrieved_chunks for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy airc_ins on public.ai_retrieved_chunks for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy aitc_sel on public.ai_tool_calls for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aitc_ins on public.ai_tool_calls for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy aiac_sel on public.ai_answer_citations for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aiac_ins on public.ai_answer_citations for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy aigd_sel on public.ai_grounding_decisions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aigd_ins on public.ai_grounding_decisions for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));

create policy aied_sel on public.ai_escalation_decisions for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aied_ins on public.ai_escalation_decisions for insert
  with check (tenant_id = public.current_tenant_id() and (public.has_permission('ai.test_lab.use') or public.has_permission('ai.copilot.use')));
create policy aied_upd on public.ai_escalation_decisions for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.runs.read'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.runs.read'));

create policy aif_sel on public.ai_feedback for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aif_ins on public.ai_feedback for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.feedback.create'));

-- Copilot drafts: scoped to ai.copilot.use (agent-facing).
create policy aicd_sel on public.ai_copilot_drafts for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.copilot.use'));
create policy aicd_ins on public.ai_copilot_drafts for insert
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.copilot.use'));
create policy aicd_upd on public.ai_copilot_drafts for update
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.copilot.use'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.copilot.use'));

-- Evaluation: read ai.runs.read; write ai.test_lab.use.
create policy aied_ds_sel on public.ai_evaluation_datasets for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aied_ds_w on public.ai_evaluation_datasets for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'));
create policy aiec_sel on public.ai_evaluation_cases for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aiec_w on public.ai_evaluation_cases for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'));
create policy aier_sel on public.ai_evaluation_runs for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aier_w on public.ai_evaluation_runs for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'));
create policy aieres_sel on public.ai_evaluation_results for select
  using (tenant_id = public.current_tenant_id() and public.is_active_member(tenant_id) and public.has_permission('ai.runs.read'));
create policy aieres_w on public.ai_evaluation_results for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('ai.test_lab.use'));

-- ---------------------------------------------------------------------------
-- Audit actions (§27) — reference ids + safe summaries only; never full content.
-- ---------------------------------------------------------------------------
insert into public.audit_actions (key, category, description, is_security) values
  ('knowledge.source.created','configuration','Knowledge source created',false),
  ('knowledge.source.updated','configuration','Knowledge source updated',false),
  ('knowledge.version.created','configuration','Knowledge version created',false),
  ('knowledge.approved','configuration','Knowledge approved',false),
  ('knowledge.rejected','configuration','Knowledge rejected',false),
  ('knowledge.superseded','configuration','Knowledge superseded',false),
  ('knowledge.archived','configuration','Knowledge archived',false),
  ('knowledge.ingestion.started','configuration','Knowledge ingestion started',false),
  ('knowledge.ingestion.failed','configuration','Knowledge ingestion failed',false),
  ('knowledge.embedding.generated','configuration','Knowledge embedding generated',false),
  ('knowledge.conflict.detected','configuration','Knowledge conflict detected',false),
  ('knowledge.conflict.resolved','configuration','Knowledge conflict resolved',false),
  ('ai.provider.updated','configuration','AI provider configuration updated',false),
  ('ai.model.updated','configuration','AI model configuration updated',false),
  ('ai.prompt.version.created','configuration','AI prompt version created',false),
  ('ai.prompt.activated','configuration','AI prompt activated',false),
  ('ai.policy.updated','configuration','AI policy updated',false),
  ('ai.test_run.executed','configuration','AI test run executed',false),
  ('ai.copilot.draft.generated','configuration','Copilot draft generated',false),
  ('ai.copilot.draft.accepted','configuration','Copilot draft accepted',false),
  ('ai.copilot.draft.edited','configuration','Copilot draft edited',false),
  ('ai.copilot.draft.discarded','configuration','Copilot draft discarded',false),
  ('ai.escalation.recommended','configuration','AI escalation recommended',false),
  ('ai.usage.limit_reached','abuse','AI usage limit reached',true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Per-tenant provisioning: grant Phase-5A permissions + safe AI defaults.
-- ---------------------------------------------------------------------------
create or replace function public.grant_phase5a_ai_perms(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, slug from public.roles where tenant_id = p_tenant loop
    if r.slug = 'client_admin' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'knowledge.read','knowledge.create','knowledge.edit','knowledge.review',
          'knowledge.approve','knowledge.archive','knowledge.conflicts.resolve',
          'ai.settings.read','ai.settings.manage','ai.providers.manage','ai.prompts.manage',
          'ai.test_lab.use','ai.runs.read','ai.feedback.create','ai.copilot.use',
          'ai.shadow.manage','ai.usage.read'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'knowledge.read','ai.settings.read','ai.runs.read','ai.test_lab.use',
          'ai.copilot.use','ai.feedback.create','ai.usage.read'
        ]) k on conflict do nothing;
    elsif r.slug = 'sales_agent' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['knowledge.read','ai.copilot.use','ai.feedback.create']) k
        on conflict do nothing;
    elsif r.slug = 'marketing_manager' then
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array['knowledge.read','ai.usage.read']) k
        on conflict do nothing;
    elsif r.slug = 'project_maintenance' then
      -- Project knowledge management; NO AI runs (no lead content), NO conversations.
      insert into public.role_permissions (role_id, permission_key)
        select r.id, k from unnest(array[
          'knowledge.read','knowledge.create','knowledge.edit','knowledge.review',
          'knowledge.approve','knowledge.archive','knowledge.conflicts.resolve'
        ]) k on conflict do nothing;
    elsif r.slug = 'viewer' then
      insert into public.role_permissions (role_id, permission_key)
        values (r.id, 'knowledge.read') on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.provision_phase5a_ai(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_chat uuid; v_embed uuid;
begin
  insert into public.ai_usage_limits (tenant_id) values (p_tenant)
    on conflict (tenant_id) do nothing;
  -- Default deterministic mock providers (external providers stay unavailable
  -- until a server-side credential is configured).
  insert into public.ai_provider_configs (tenant_id, kind, adapter, display_name, available)
    values (p_tenant, 'chat', 'mock', 'Development mock chat', true)
    returning id into v_chat;
  insert into public.ai_provider_configs (tenant_id, kind, adapter, display_name, available)
    values (p_tenant, 'embedding', 'mock', 'Development mock embeddings', true)
    returning id into v_embed;
  insert into public.ai_model_configs (tenant_id, provider_config_id, model_name)
    values (p_tenant, v_chat, 'mock-chat-v1');
  insert into public.embedding_model_configs (tenant_id, provider_config_id, model_name, dimensions)
    values (p_tenant, v_embed, 'mock-embed-v1', 16);
  -- Tenant-level AI policy defaults to DISABLED (no AI answering).
  insert into public.ai_feature_policies (tenant_id, project_id, operating_level)
    values (p_tenant, null, 'disabled')
    on conflict (tenant_id, project_id) do nothing;
end $$;

-- New tenants: run the Phase-5A grants + provisioning after base provisioning.
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
  return new;
end; $$;

-- Backfill existing tenants (forward-only).
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.grant_phase5a_ai_perms(t.id);
    perform public.provision_phase5a_ai(t.id);
  end loop;
end $$;
