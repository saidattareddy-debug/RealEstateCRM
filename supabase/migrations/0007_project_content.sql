-- 0007_project_content.sql
-- Phase 2 remainder — project content: FAQs, media and documents (URL-referenced
-- metadata; binary upload to Supabase Storage is wired in a later pass). RLS:
-- read = projects.read, write = projects.manage.

create type public.project_media_kind as enum ('image', 'video', 'floor_plan', 'location_map');
create type public.project_document_type as enum (
  'brochure', 'price_list', 'payment_plan', 'legal', 'rera', 'other'
);

create table public.project_faqs (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_faqs_project on public.project_faqs (project_id);

create table public.project_media (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.project_media_kind not null default 'image',
  url text not null,
  caption text,
  created_at timestamptz not null default now()
);
create index idx_media_project on public.project_media (project_id);

create table public.project_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  doc_type public.project_document_type not null default 'brochure',
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index idx_documents_project on public.project_documents (project_id);

-- RLS
alter table public.project_faqs      enable row level security;
alter table public.project_media     enable row level security;
alter table public.project_documents enable row level security;

create policy faqs_select on public.project_faqs for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy faqs_write on public.project_faqs for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy media_select on public.project_media for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy media_write on public.project_media for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

create policy documents_select on public.project_documents for select
  using (public.is_active_member(tenant_id) and public.has_permission('projects.read'));
create policy documents_write on public.project_documents for all
  using (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('projects.manage'));

grant select, insert, update, delete on
  public.project_faqs, public.project_media, public.project_documents to authenticated;
