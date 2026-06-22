'use server';

import { revalidatePath } from 'next/cache';
import { createProjectSchema, createUnitSchema, updateUnitStatusSchema } from '@re/validation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'projects.manage')) {
    return { error: 'You do not have permission to create projects.' };
  }
  const parsed = createProjectSchema.safeParse({
    name: formData.get('name'),
    developer: formData.get('developer') || null,
    category: formData.get('category'),
    saleStatus: formData.get('saleStatus') || 'active',
    constructionStatus: formData.get('constructionStatus') || null,
    locality: formData.get('locality') || null,
    priceMin: formData.get('priceMin') || null,
    priceMax: formData.get('priceMax') || null,
  });
  if (!parsed.success) return { error: 'Check the project details.' };
  const p = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from('projects')
    .insert({
      tenant_id: ctx.activeTenantId,
      name: p.name,
      developer: p.developer ?? null,
      category: p.category,
      sale_status: p.saleStatus,
      construction_status: p.constructionStatus ?? null,
      locality: p.locality ?? null,
      price_min: p.priceMin ?? null,
      price_max: p.priceMax ?? null,
      created_by: ctx.userId,
    })
    .select('id')
    .maybeSingle();
  if (error) return { error: 'Could not create the project.' };

  await writeAudit({
    action: 'PROJECT_CREATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'project',
    entityId: (inserted?.id as string) ?? null,
    newValues: { name: p.name, category: p.category },
  });

  revalidatePath('/projects');
  return { ok: true };
}

export async function approveProjectAction(projectId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'projects.manage')) {
    return { error: 'You do not have permission to approve projects.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('projects')
    .update({
      approval_status: 'approved',
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not approve the project.' };

  await writeAudit({
    action: 'PROJECT_APPROVE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'project',
    entityId: projectId,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { ok: true };
}

export async function createUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'inventory.manage')) {
    return { error: 'You do not have permission to manage inventory.' };
  }
  const parsed = createUnitSchema.safeParse({
    projectId: formData.get('projectId'),
    unitNumber: formData.get('unitNumber'),
    status: formData.get('status') || 'available',
    price: formData.get('price') || null,
    carpetAreaSqft: formData.get('carpetAreaSqft') || null,
  });
  if (!parsed.success) return { error: 'Check the unit details.' };
  const u = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from('inventory_units')
    .insert({
      tenant_id: ctx.activeTenantId,
      project_id: u.projectId,
      unit_number: u.unitNumber,
      status: u.status,
      price: u.price ?? null,
      carpet_area_sqft: u.carpetAreaSqft ?? null,
    })
    .select('id')
    .maybeSingle();
  if (error) return { error: 'Could not create the unit (duplicate number?).' };

  await writeAudit({
    action: 'INVENTORY_UPDATE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'inventory_unit',
    entityId: (inserted?.id as string) ?? null,
    newValues: { unit_number: u.unitNumber, status: u.status },
  });

  revalidatePath(`/projects/${u.projectId}`);
  return { ok: true };
}

export async function updateUnitStatusAction(unitId: string, status: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'inventory.manage')) {
    return { error: 'You do not have permission to manage inventory.' };
  }
  const parsed = updateUnitStatusSchema.safeParse({ unitId, status });
  if (!parsed.success) return { error: 'Invalid status.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('inventory_units')
    .select('project_id, status')
    .eq('id', unitId)
    .maybeSingle();

  const { error } = await supabase
    .from('inventory_units')
    .update({ status: parsed.data.status, last_verified_at: new Date().toISOString() })
    .eq('id', unitId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update the unit.' };

  await writeAudit({
    action: 'INVENTORY_STATUS_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'inventory_unit',
    entityId: unitId,
    previousValues: before ? { status: before.status } : null,
    newValues: { status: parsed.data.status },
  });

  if (before?.project_id) revalidatePath(`/projects/${before.project_id as string}`);
  revalidatePath('/inventory');
  return { ok: true };
}
