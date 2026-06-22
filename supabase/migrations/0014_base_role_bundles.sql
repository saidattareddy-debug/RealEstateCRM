-- =====================================================================
-- Phase 4.1 (item 14) — fold the conversation permission grants into the
-- base role-seeding function so a tenant provisioned AFTER all migrations
-- receives them as part of role seeding (not only via the on_tenant_created
-- post-step). Forward-only: previous migrations are untouched.
-- =====================================================================

create or replace function public.seed_default_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid;
begin
  -- client_admin
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'client_admin', 'Client Admin', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key)
    select v_role, key from public.permissions
    where key like 'settings.%' or key like 'users.%' or key like 'agents.%'
       or key in ('team.performance.read')
       or key like 'projects.%' or key like 'inventory.%' or key like 'knowledge.%'
       or key in ('staledata.resolve')
       or key in ('leads.read.all','leads.create','leads.update','leads.assign',
                  'leads.reassign','leads.merge','leads.export','leads.classify.override')
       or key like 'conversations.%'
       or key like 'website_chat.%' or key in ('messages.redact','canned_replies.manage',
                  'consent.manage','dnc.manage')
       or key in ('pipeline.configure','pipeline.move','tasks.manage','calls.manage',
                  'sitevisits.read','sitevisits.manage')
       or key in ('scoring.read','scoring.edit','scoring.approve','scoring.publish',
                  'automations.manage','assignment.configure')
       or key in ('campaigns.manage','sources.manage','forms.manage','attribution.read')
       or key like 'analytics.%'
       or key in ('billing.read','billing.manage')
    on conflict do nothing;

  -- marketing_manager (metadata-only conversation visibility)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'marketing_manager', 'Marketing Manager', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'campaigns.manage'),(v_role,'sources.manage'),(v_role,'forms.manage'),
    (v_role,'attribution.read'),(v_role,'analytics.marketing.read'),(v_role,'leads.create'),
    (v_role,'leads.read.team'),(v_role,'scoring.read'),(v_role,'scoring.edit'),
    (v_role,'automations.manage'),(v_role,'projects.read'),(v_role,'inventory.read'),
    (v_role,'conversations.read.metadata')
    on conflict do nothing;

  -- sales_manager (team + management)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'sales_manager', 'Sales Manager', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'team.performance.read'),(v_role,'agents.manage'),(v_role,'agents.availability.manage'),
    (v_role,'pipeline.configure'),(v_role,'pipeline.move'),(v_role,'assignment.configure'),
    (v_role,'leads.read.team'),(v_role,'leads.update'),(v_role,'leads.assign'),
    (v_role,'leads.reassign'),(v_role,'leads.classify.override'),
    (v_role,'conversations.read.private'),(v_role,'conversations.read.team'),
    (v_role,'conversations.read.metadata'),(v_role,'conversations.reply'),
    (v_role,'conversations.takeover'),(v_role,'conversations.transfer'),
    (v_role,'conversations.assign'),(v_role,'conversations.close'),(v_role,'conversations.reopen'),
    (v_role,'conversations.priority.manage'),(v_role,'conversations.tags.manage'),
    (v_role,'conversations.notes.create'),(v_role,'conversations.notes.manage'),
    (v_role,'conversations.ai.resume'),(v_role,'conversations.export'),
    (v_role,'messages.redact'),(v_role,'canned_replies.manage'),
    (v_role,'website_chat.manage'),(v_role,'website_chat.view_sessions'),
    (v_role,'consent.manage'),(v_role,'dnc.manage'),
    (v_role,'tasks.manage'),(v_role,'calls.manage'),(v_role,'sitevisits.read'),
    (v_role,'sitevisits.manage'),(v_role,'scoring.read'),(v_role,'scoring.edit'),
    (v_role,'scoring.approve'),(v_role,'scoring.publish'),(v_role,'projects.read'),
    (v_role,'inventory.read'),(v_role,'analytics.sales.read'),(v_role,'analytics.agents.read')
    on conflict do nothing;

  -- sales_agent (assigned-only; NO read.metadata)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'sales_agent', 'Sales Agent', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'leads.read.assigned'),(v_role,'leads.update'),
    (v_role,'conversations.read.assigned'),(v_role,'conversations.reply'),
    (v_role,'conversations.takeover'),(v_role,'conversations.close'),
    (v_role,'conversations.reopen'),(v_role,'conversations.notes.create'),
    (v_role,'conversations.ai.resume'),(v_role,'conversations.tags.manage'),
    (v_role,'pipeline.move'),(v_role,'tasks.manage'),
    (v_role,'calls.manage'),(v_role,'sitevisits.read'),(v_role,'sitevisits.manage'),
    (v_role,'projects.read'),(v_role,'inventory.read'),(v_role,'scoring.read')
    on conflict do nothing;

  -- project_maintenance (NO private conversation access)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'project_maintenance', 'Project Data & Maintenance', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'projects.read'),(v_role,'projects.manage'),(v_role,'inventory.read'),
    (v_role,'inventory.manage'),(v_role,'inventory.import'),(v_role,'knowledge.manage'),
    (v_role,'knowledge.approve'),(v_role,'staledata.resolve')
    on conflict do nothing;

  -- viewer (read-only)
  insert into public.roles (tenant_id, slug, name, is_system)
    values (p_tenant, 'viewer', 'Viewer', true)
    returning id into v_role;
  insert into public.role_permissions (role_id, permission_key) values
    (v_role,'projects.read'),(v_role,'inventory.read'),(v_role,'leads.read.team'),
    (v_role,'sitevisits.read'),(v_role,'analytics.sales.read'),(v_role,'analytics.marketing.read'),
    (v_role,'analytics.agents.read'),(v_role,'attribution.read'),(v_role,'billing.read'),
    (v_role,'scoring.read')
    on conflict do nothing;
end;
$$;
