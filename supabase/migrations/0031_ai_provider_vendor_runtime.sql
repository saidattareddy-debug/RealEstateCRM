-- =====================================================================
-- Phase 5B.1 — explicit AI provider vendor metadata for live runtime
-- activation. Forward-only.
-- =====================================================================

create type public.ai_provider_vendor as enum ('mock', 'anthropic', 'openai', 'gemini');

alter table public.ai_provider_configs
  add column vendor public.ai_provider_vendor;

update public.ai_provider_configs
set vendor = case
  when adapter = 'mock' then 'mock'::public.ai_provider_vendor
  when coalesce(secret_ref, '') ilike '%ANTHROPIC%' then 'anthropic'::public.ai_provider_vendor
  when coalesce(secret_ref, '') ilike '%OPENAI%' then 'openai'::public.ai_provider_vendor
  when coalesce(secret_ref, '') ilike '%GEMINI%' then 'gemini'::public.ai_provider_vendor
  when kind = 'embedding' then 'openai'::public.ai_provider_vendor
  else 'anthropic'::public.ai_provider_vendor
end
where vendor is null;

alter table public.ai_provider_configs
  alter column vendor set not null;

alter table public.ai_provider_configs
  add constraint ai_provider_configs_vendor_matches_adapter
  check (
    (adapter = 'mock' and vendor = 'mock')
    or (adapter = 'external' and vendor <> 'mock')
  );

create index idx_ai_provider_vendor on public.ai_provider_configs (tenant_id, kind, vendor, active);

create or replace function public.provision_phase5a_ai(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_chat uuid; v_embed uuid;
begin
  insert into public.ai_usage_limits (tenant_id) values (p_tenant)
    on conflict (tenant_id) do nothing;

  insert into public.ai_provider_configs (tenant_id, kind, adapter, vendor, display_name, available)
    values (p_tenant, 'chat', 'mock', 'mock', 'Development mock chat', true)
    returning id into v_chat;

  insert into public.ai_provider_configs (tenant_id, kind, adapter, vendor, display_name, available)
    values (p_tenant, 'embedding', 'mock', 'mock', 'Development mock embeddings', true)
    returning id into v_embed;

  insert into public.ai_model_configs (tenant_id, provider_config_id, model_name)
    values (p_tenant, v_chat, 'mock-chat-v1');

  insert into public.embedding_model_configs (tenant_id, provider_config_id, model_name, dimensions)
    values (p_tenant, v_embed, 'mock-embed-v1', 16);

  insert into public.ai_feature_policies (tenant_id, project_id, operating_level)
    values (p_tenant, null, 'disabled')
    on conflict (tenant_id, project_id) do nothing;
end $$;
