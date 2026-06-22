'use server';

import { revalidatePath } from 'next/cache';
import { mapRows, type ImportMapping } from '@re/domain';
import { importMappingSchema } from '@re/validation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { parseCsv } from '@/lib/inventory/csv';

export interface ActionState {
  ok?: boolean;
  error?: string;
  summary?: { total: number; imported: number; errors: number };
}

/** Bulk-apply a status to several units at once (inventory.manage). */
export async function bulkUpdateUnitStatusAction(
  unitIds: string[],
  status: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'inventory.manage')) {
    return { error: 'You do not have permission to manage inventory.' };
  }
  if (unitIds.length === 0) return { error: 'Select at least one unit.' };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from('inventory_units')
    .update({ status, last_verified_at: new Date().toISOString() }, { count: 'exact' })
    .in('id', unitIds)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Bulk update failed.' };

  await writeAudit({
    action: 'INVENTORY_STATUS_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'inventory_unit',
    entityId: null,
    newValues: { status, count: count ?? unitIds.length, bulk: true },
  });

  revalidatePath('/inventory');
  return { ok: true, summary: { total: unitIds.length, imported: count ?? 0, errors: 0 } };
}

/** Re-verify a stale unit's availability (bumps last_verified_at). */
export async function resolveStaleAction(unitId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'staledata.resolve')) {
    return { error: 'You do not have permission to resolve stale data.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('inventory_units')
    .update({ last_verified_at: new Date().toISOString() })
    .eq('id', unitId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not re-verify the unit.' };

  await writeAudit({
    action: 'STALEDATA_RESOLVE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'inventory_unit',
    entityId: unitId,
  });

  revalidatePath('/inventory');
  return { ok: true };
}

/** Import inventory from pasted/uploaded CSV using a column mapping. */
export async function importInventoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'inventory.import')) {
    return { error: 'You do not have permission to import inventory.' };
  }
  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return { error: 'Select a project.' };

  let mapping: ImportMapping;
  try {
    mapping = importMappingSchema.parse(JSON.parse(String(formData.get('mapping') ?? '{}')));
  } catch {
    return { error: 'Map at least the unit number column.' };
  }

  // Rows are parsed client-side (CSV or XLSX) and submitted as JSON; a raw CSV
  // string is accepted as a fallback.
  let rows: Record<string, string>[];
  const rowsJson = String(formData.get('rowsJson') ?? '');
  if (rowsJson) {
    try {
      rows = JSON.parse(rowsJson) as Record<string, string>[];
    } catch {
      return { error: 'Could not read the uploaded rows.' };
    }
  } else {
    const csv = String(formData.get('csv') ?? '');
    if (!csv.trim()) return { error: 'Provide CSV/XLSX content.' };
    rows = parseCsv(csv).rows;
  }

  const { mapped, errors } = mapRows(rows, mapping);

  const supabase = await createSupabaseServerClient();
  const { data: importRow } = await supabase
    .from('inventory_imports')
    .insert({
      tenant_id: ctx.activeTenantId,
      project_id: projectId,
      filename: String(formData.get('filename') ?? 'pasted.csv'),
      status: 'processing',
      total_rows: rows.length,
      mapping,
      created_by: ctx.userId,
    })
    .select('id')
    .maybeSingle();
  const importId = importRow?.id as string | undefined;

  let imported = 0;
  if (mapped.length > 0) {
    const { error, count } = await supabase.from('inventory_units').insert(
      mapped.map((u) => ({
        tenant_id: ctx.activeTenantId,
        project_id: projectId,
        unit_number: u.unit_number,
        status: u.status,
        price: u.price ?? null,
        carpet_area_sqft: u.carpet_area_sqft ?? null,
      })),
      { count: 'exact' },
    );
    if (error) {
      // Likely duplicate unit numbers — surface as a row-level concern.
      errors.push({ row: 0, error: 'Some units conflicted (duplicate unit numbers).' });
    } else {
      imported = count ?? mapped.length;
    }
  }

  if (importId && errors.length > 0) {
    await supabase.from('inventory_import_rows').insert(
      errors.map((e) => ({
        tenant_id: ctx.activeTenantId,
        import_id: importId,
        row_number: e.row,
        raw: {},
        error: e.error,
      })),
    );
  }
  if (importId) {
    await supabase
      .from('inventory_imports')
      .update({
        status: errors.length && imported === 0 ? 'failed' : 'completed',
        imported_rows: imported,
        error_rows: errors.length,
      })
      .eq('id', importId);
  }

  await writeAudit({
    action: 'INVENTORY_IMPORT',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'inventory_import',
    entityId: importId ?? null,
    newValues: { total: rows.length, imported, errors: errors.length },
  });

  revalidatePath('/inventory');
  return { ok: true, summary: { total: rows.length, imported, errors: errors.length } };
}
