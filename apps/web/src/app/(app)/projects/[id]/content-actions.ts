'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { updateProjectSchema } from '@re/validation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

async function guard() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'projects.manage')) return null;
  return ctx;
}

async function auditProject(
  ctx: { activeTenantId: string | null; userId: string },
  projectId: string,
  change: Record<string, unknown>,
) {
  await writeAudit({
    action: 'PROJECT_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'project',
    entityId: projectId,
    newValues: change,
  });
}

/** Update core project fields. */
export async function updateProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'You do not have permission to edit projects.' };
  const projectId = String(formData.get('projectId') ?? '');
  const parsed = updateProjectSchema.safeParse({
    name: formData.get('name') || undefined,
    developer: formData.get('developer') || null,
    category: formData.get('category') || undefined,
    saleStatus: formData.get('saleStatus') || undefined,
    constructionStatus: formData.get('constructionStatus') || null,
    locality: formData.get('locality') || null,
    priceMin: formData.get('priceMin') || null,
    priceMax: formData.get('priceMax') || null,
  });
  if (!parsed.success) return { error: 'Check the project fields.' };
  const p = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('projects')
    .update({
      name: p.name,
      developer: p.developer ?? null,
      category: p.category,
      sale_status: p.saleStatus,
      construction_status: p.constructionStatus ?? null,
      locality: p.locality ?? null,
      price_min: p.priceMin ?? null,
      price_max: p.priceMax ?? null,
    })
    .eq('id', projectId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Update failed.' };

  await auditProject(ctx, projectId, { fields: Object.keys(p) });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const configSchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().min(1).max(60),
  carpetAreaSqft: z.coerce.number().positive().optional().nullable(),
  basePrice: z.coerce.number().nonnegative().optional().nullable(),
});

export async function addConfigurationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const parsed = configSchema.safeParse({
    projectId: formData.get('projectId'),
    label: formData.get('label'),
    carpetAreaSqft: formData.get('carpetAreaSqft') || null,
    basePrice: formData.get('basePrice') || null,
  });
  if (!parsed.success) return { error: 'Check the configuration.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('project_configurations').insert({
    tenant_id: ctx.activeTenantId,
    project_id: parsed.data.projectId,
    label: parsed.data.label,
    carpet_area_sqft: parsed.data.carpetAreaSqft ?? null,
    base_price: parsed.data.basePrice ?? null,
  });
  if (error) return { error: 'Could not add configuration.' };
  await auditProject(ctx, parsed.data.projectId, {
    added: 'configuration',
    label: parsed.data.label,
  });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

/** Generic delete of a project child row (by table + id), tenant-scoped. */
async function deleteChild(table: string, id: string, projectId: string): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not delete.' };
  await auditProject(ctx, projectId, { deleted: table, id });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteConfigurationAction(projectId: string, id: string) {
  return deleteChild('project_configurations', id, projectId);
}

const amenitySchema = z.object({ projectId: z.string().uuid(), name: z.string().min(1).max(80) });
export async function addAmenityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const parsed = amenitySchema.safeParse({
    projectId: formData.get('projectId'),
    name: formData.get('name'),
  });
  if (!parsed.success) return { error: 'Enter an amenity name.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('project_amenities').insert({
    tenant_id: ctx.activeTenantId,
    project_id: parsed.data.projectId,
    name: parsed.data.name,
  });
  if (error) return { error: 'Could not add amenity.' };
  await auditProject(ctx, parsed.data.projectId, { added: 'amenity', name: parsed.data.name });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
export async function deleteAmenityAction(projectId: string, id: string) {
  return deleteChild('project_amenities', id, projectId);
}

const offerSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
  details: z.string().max(500).optional().nullable(),
});
export async function addOfferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const parsed = offerSchema.safeParse({
    projectId: formData.get('projectId'),
    title: formData.get('title'),
    details: formData.get('details') || null,
  });
  if (!parsed.success) return { error: 'Enter an offer title.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('project_offers').insert({
    tenant_id: ctx.activeTenantId,
    project_id: parsed.data.projectId,
    title: parsed.data.title,
    details: parsed.data.details ?? null,
  });
  if (error) return { error: 'Could not add offer.' };
  await auditProject(ctx, parsed.data.projectId, { added: 'offer', title: parsed.data.title });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
export async function deleteOfferAction(projectId: string, id: string) {
  return deleteChild('project_offers', id, projectId);
}

const faqSchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
});
export async function addFaqAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const parsed = faqSchema.safeParse({
    projectId: formData.get('projectId'),
    question: formData.get('question'),
    answer: formData.get('answer'),
  });
  if (!parsed.success) return { error: 'Enter a question and answer.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('project_faqs').insert({
    tenant_id: ctx.activeTenantId,
    project_id: parsed.data.projectId,
    question: parsed.data.question,
    answer: parsed.data.answer,
  });
  if (error) return { error: 'Could not add FAQ.' };
  await auditProject(ctx, parsed.data.projectId, { added: 'faq' });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
export async function deleteFaqAction(projectId: string, id: string) {
  return deleteChild('project_faqs', id, projectId);
}

const docSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(160),
  url: z.string().url(),
  docType: z
    .enum(['brochure', 'price_list', 'payment_plan', 'legal', 'rera', 'other'])
    .default('brochure'),
});
export async function addDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await guard();
  if (!ctx) return { error: 'Permission denied.' };
  const parsed = docSchema.safeParse({
    projectId: formData.get('projectId'),
    title: formData.get('title'),
    url: formData.get('url'),
    docType: formData.get('docType') || 'brochure',
  });
  if (!parsed.success) return { error: 'Enter a title and a valid URL.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('project_documents').insert({
    tenant_id: ctx.activeTenantId,
    project_id: parsed.data.projectId,
    title: parsed.data.title,
    url: parsed.data.url,
    doc_type: parsed.data.docType,
  });
  if (error) return { error: 'Could not add document.' };
  await auditProject(ctx, parsed.data.projectId, { added: 'document', title: parsed.data.title });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
export async function deleteDocumentAction(projectId: string, id: string) {
  return deleteChild('project_documents', id, projectId);
}
