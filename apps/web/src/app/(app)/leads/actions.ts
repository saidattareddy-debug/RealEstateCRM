'use server';

import { revalidatePath } from 'next/cache';
import {
  leadInputSchema,
  createNoteSchema,
  moveStageSchema,
  assignLeadSchema,
  resolveDuplicateSchema,
  logCallSchema,
  saveViewSchema,
} from '@re/validation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { ingestLead } from '@/lib/leads/ingest';
import { parseCsv } from '@/lib/inventory/csv';

export interface ActionState {
  ok?: boolean;
  error?: string;
  summary?: string;
}

export async function createLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.create')) {
    return { error: 'You do not have permission to create leads.' };
  }
  const parsed = leadInputSchema.safeParse({
    fullName: formData.get('fullName') || null,
    phone: formData.get('phone') || null,
    email: formData.get('email') || null,
    preferredLanguage: formData.get('preferredLanguage') || null,
    campaign: formData.get('campaign') || null,
    source: 'manual',
  });
  if (!parsed.success) return { error: 'Check the lead details (valid email/phone).' };

  const res = await ingestLead(ctx.activeTenantId, parsed.data, {
    actorUserId: ctx.userId,
    sourceKind: 'manual',
  });
  revalidatePath('/leads');
  return {
    ok: true,
    summary:
      res.duplicates > 0
        ? `Created — ${res.duplicates} possible duplicate(s) flagged.`
        : 'Lead created.',
  };
}

export async function importLeadsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.create')) {
    return { error: 'You do not have permission to import leads.' };
  }
  const csv = String(formData.get('csv') ?? '');
  if (!csv.trim()) return { error: 'Paste CSV (headers: name, phone, email).' };
  const { rows } = parseCsv(csv);
  let imported = 0;
  let dupes = 0;
  for (const r of rows) {
    const parsed = leadInputSchema.safeParse({
      fullName: r['name'] ?? r['full_name'] ?? null,
      phone: r['phone'] ?? null,
      email: r['email'] || null,
      campaign: r['campaign'] ?? null,
      source: r['source'] ?? 'csv',
    });
    if (!parsed.success) continue;
    const res = await ingestLead(ctx.activeTenantId, parsed.data, {
      actorUserId: ctx.userId,
      sourceKind: 'csv',
    });
    imported++;
    dupes += res.duplicates;
  }
  revalidatePath('/leads');
  return {
    ok: true,
    summary: `Imported ${imported} of ${rows.length} rows · ${dupes} duplicate flag(s).`,
  };
}

export async function moveStageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'pipeline.move')) {
    return { error: 'You do not have permission to move leads.' };
  }
  const parsed = moveStageSchema.safeParse({
    leadId: formData.get('leadId'),
    stageId: formData.get('stageId'),
    reason: formData.get('reason') || null,
  });
  if (!parsed.success) return { error: 'Invalid stage move.' };

  const supabase = await createSupabaseServerClient();
  // Pipeline rule: moving into a terminal "lost"/"disqualified" stage requires a reason.
  const { data: target } = await supabase
    .from('pipeline_stages')
    .select('name, is_lost')
    .eq('id', parsed.data.stageId)
    .maybeSingle();
  if (target?.is_lost && !(parsed.data.reason && parsed.data.reason.trim())) {
    return { error: `A reason is required to move a lead to "${target.name}".` };
  }

  const { data: before } = await supabase
    .from('leads')
    .select('stage_id')
    .eq('id', parsed.data.leadId)
    .maybeSingle();
  const leadUpdate: Record<string, unknown> = { stage_id: parsed.data.stageId };
  if (target?.is_lost) {
    leadUpdate.operational_status = 'disqualified';
  }
  const { error } = await supabase
    .from('leads')
    .update(leadUpdate)
    .eq('id', parsed.data.leadId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Stage move failed (permission?).' };

  await supabase.from('lead_stage_history').insert({
    tenant_id: ctx.activeTenantId,
    lead_id: parsed.data.leadId,
    from_stage_id: (before?.stage_id as string | null) ?? null,
    to_stage_id: parsed.data.stageId,
    changed_by: ctx.userId,
    reason: parsed.data.reason ?? null,
  });
  await writeAudit({
    action: 'LEAD_STAGE_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: parsed.data.leadId,
    previousValues: { stage_id: before?.stage_id ?? null },
    newValues: { stage_id: parsed.data.stageId },
  });
  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath('/pipeline');
  return { ok: true };
}

/** Bulk-move several leads to a stage at once (pipeline.move). */
export async function bulkMoveStageAction(
  leadIds: string[],
  stageId: string,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'pipeline.move')) {
    return { error: 'You do not have permission to move leads.' };
  }
  if (leadIds.length === 0 || !stageId) return { error: 'Select leads and a stage.' };

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from('leads')
    .select('id, stage_id')
    .in('id', leadIds)
    .eq('tenant_id', ctx.activeTenantId);
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: stageId })
    .in('id', leadIds)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Bulk move failed.' };

  // Stage-history rows + a single audit entry.
  await supabase.from('lead_stage_history').insert(
    (rows ?? []).map((r) => ({
      tenant_id: ctx.activeTenantId,
      lead_id: r.id as string,
      from_stage_id: (r.stage_id as string | null) ?? null,
      to_stage_id: stageId,
      changed_by: ctx.userId,
      reason: 'bulk',
    })),
  );
  await writeAudit({
    action: 'LEAD_STAGE_CHANGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: null,
    newValues: { stageId, count: leadIds.length, bulk: true },
  });
  revalidatePath('/leads');
  revalidatePath('/pipeline');
  return { ok: true };
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.update')) {
    return { error: 'You do not have permission to add notes.' };
  }
  const parsed = createNoteSchema.safeParse({
    leadId: formData.get('leadId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return { error: 'Enter a note.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('lead_notes').insert({
    tenant_id: ctx.activeTenantId,
    lead_id: parsed.data.leadId,
    author_id: ctx.userId,
    body: parsed.data.body,
  });
  if (error) return { error: 'Could not add note.' };
  await writeAudit({
    action: 'LEAD_NOTE_ADD',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: parsed.data.leadId,
  });
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

/** Log a manual call (no telephony). Optionally create a callback task. */
export async function logCallAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.update')) {
    return { error: 'You do not have permission to log calls.' };
  }
  // <input type="datetime-local"> yields "YYYY-MM-DDThh:mm" (no tz); normalise to ISO.
  const rawCallback = String(formData.get('callbackAt') ?? '');
  let callbackAt: string | null = null;
  if (rawCallback) {
    const d = new Date(rawCallback);
    if (!Number.isNaN(d.getTime())) callbackAt = d.toISOString();
  }
  const parsed = logCallSchema.safeParse({
    leadId: formData.get('leadId'),
    direction: formData.get('direction'),
    status: formData.get('status'),
    outcome: formData.get('outcome') || null,
    durationSeconds: formData.get('durationSeconds') || null,
    notes: formData.get('notes') || null,
    callbackAt,
  });
  if (!parsed.success) return { error: 'Check the call details.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('calls').insert({
    tenant_id: ctx.activeTenantId,
    lead_id: parsed.data.leadId,
    agent_id: ctx.userId,
    direction: parsed.data.direction,
    status: parsed.data.status,
    started_at: new Date().toISOString(),
    outcome: parsed.data.outcome ?? null,
    duration_seconds: parsed.data.durationSeconds ?? null,
    notes: parsed.data.notes ?? null,
    callback_requested: Boolean(parsed.data.callbackAt),
    callback_at: parsed.data.callbackAt ?? null,
  });
  if (error) return { error: 'Could not log the call.' };

  // Optional callback task.
  if (parsed.data.callbackAt && ensurePermission(ctx, 'tasks.manage')) {
    await supabase.from('tasks').insert({
      tenant_id: ctx.activeTenantId,
      lead_id: parsed.data.leadId,
      title: 'Callback',
      due_at: parsed.data.callbackAt,
      status: 'open',
      created_by: ctx.userId,
    });
  }

  await writeAudit({
    action: 'CALL_LOG',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: parsed.data.leadId,
    newValues: { direction: parsed.data.direction, status: parsed.data.status },
  });
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}

/** Save / update a saved view. Scope never widens the caller's RLS visibility. */
export async function saveViewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(String(formData.get('config') ?? '{}'));
  } catch {
    return { error: 'Invalid view configuration.' };
  }
  const parsed = saveViewSchema.safeParse({
    id: formData.get('id') || null,
    name: formData.get('name'),
    scope: formData.get('scope') || 'private',
    config,
    isDefault: formData.get('isDefault') === 'on',
  });
  if (!parsed.success) return { error: 'Enter a view name.' };

  // Sharing beyond yourself requires the share permission.
  if (parsed.data.scope !== 'private' && !ensurePermission(ctx, 'leads.read.team')) {
    return { error: 'You cannot share a view beyond yourself.' };
  }

  // Map the opaque config blob onto the structured saved_views columns.
  const cfg = parsed.data.config as {
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    columns?: unknown[];
    pageSize?: number;
  };
  const supabase = await createSupabaseServerClient();
  const row = {
    tenant_id: ctx.activeTenantId,
    owner_id: ctx.userId,
    entity: 'leads',
    name: parsed.data.name,
    scope: parsed.data.scope,
    filters: cfg.filters ?? {},
    sort: cfg.sort ?? {},
    columns: cfg.columns ?? [],
    page_size: cfg.pageSize ?? 50,
    is_default: parsed.data.isDefault,
  };
  const { error } = parsed.data.id
    ? await supabase
        .from('saved_views')
        .update(row)
        .eq('id', parsed.data.id)
        .eq('owner_id', ctx.userId)
    : await supabase.from('saved_views').insert(row);
  if (error) return { error: 'Could not save the view.' };

  await writeAudit({
    action: 'VIEW_SAVE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'saved_view',
    entityId: parsed.data.id ?? null,
    newValues: { name: parsed.data.name, scope: parsed.data.scope },
  });
  revalidatePath('/leads');
  return { ok: true };
}

export async function deleteViewAction(viewId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('saved_views')
    .delete()
    .eq('id', viewId)
    .eq('owner_id', ctx.userId);
  if (error) return { error: 'Could not delete the view.' };
  revalidatePath('/leads');
  return { ok: true };
}

export async function assignLeadAction(leadId: string, agentId: string): Promise<ActionState> {
  const ctx = await getAppContext();
  if (
    !ctx.activeTenantId ||
    !(ensurePermission(ctx, 'leads.assign') || ensurePermission(ctx, 'leads.reassign'))
  ) {
    return { error: 'You do not have permission to assign leads.' };
  }
  const parsed = assignLeadSchema.safeParse({ leadId, agentId });
  if (!parsed.success) return { error: 'Invalid assignment.' };

  const supabase = await createSupabaseServerClient();
  await supabase
    .from('lead_assignments')
    .update({ active: false })
    .eq('lead_id', leadId)
    .eq('tenant_id', ctx.activeTenantId)
    .eq('active', true);
  const { error } = await supabase.from('lead_assignments').insert({
    tenant_id: ctx.activeTenantId,
    lead_id: leadId,
    agent_id: agentId,
    is_manual: true,
    active: true,
    assigned_by: ctx.userId,
    reason: 'manual',
  });
  if (error) return { error: 'Assignment failed.' };
  await writeAudit({
    action: 'LEAD_ASSIGN',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: leadId,
    newValues: { agentId, manual: true },
  });
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Resolve a flagged duplicate: dismiss, or reversibly merge into the older lead. */
export async function resolveDuplicateAction(
  duplicateId: string,
  action: 'merge' | 'dismiss',
  opts?: { sourcePrecedence?: string; commissionExposure?: number },
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'leads.merge')) {
    return { error: 'You do not have permission to resolve duplicates.' };
  }
  const parsed = resolveDuplicateSchema.safeParse({ duplicateId, action });
  if (!parsed.success) return { error: 'Invalid request.' };

  const admin = createSupabaseAdminClient();
  const { data: dup } = await admin
    .from('lead_duplicates')
    .select('id, lead_id, duplicate_lead_id, status')
    .eq('id', duplicateId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!dup || dup.status !== 'open') return { error: 'Duplicate not found or already resolved.' };

  if (action === 'dismiss') {
    await admin.from('lead_duplicates').update({ status: 'dismissed' }).eq('id', duplicateId);
    await writeAudit({
      action: 'LEAD_DEDUPE_DISMISS',
      tenantId: ctx.activeTenantId,
      actorUserId: ctx.userId,
      entityType: 'lead_duplicate',
      entityId: duplicateId,
    });
    revalidatePath('/leads/duplicates');
    return { ok: true };
  }

  // Merge: keep the OLDER lead as canonical, fold the newer one into it.
  const a = dup.lead_id as string;
  const b = dup.duplicate_lead_id as string;
  const { data: leads } = await admin.from('leads').select('id, created_at').in('id', [a, b]);
  const sorted = (leads ?? []).sort(
    (x, y) =>
      new Date(x.created_at as string).getTime() - new Date(y.created_at as string).getTime(),
  );
  const primaryId = (sorted[0]?.id as string) ?? a;
  const mergedId = primaryId === a ? b : a;

  // Snapshot the merged lead for reversibility.
  const { data: snapshot } = await admin.from('leads').select('*').eq('id', mergedId).maybeSingle();

  // Move children to the primary lead.
  for (const table of [
    'lead_notes',
    'lead_assignments',
    'lead_contacts',
    'lead_source_events',
    'attribution_touchpoints',
    'lead_activity_events',
    'tasks',
  ]) {
    await admin
      .from(table)
      .update({ lead_id: primaryId })
      .eq('lead_id', mergedId)
      .eq('tenant_id', ctx.activeTenantId);
  }
  // Soft-delete the merged lead and point it at the canonical one.
  await admin
    .from('leads')
    .update({ deleted_at: new Date().toISOString(), merged_into_lead_id: primaryId })
    .eq('id', mergedId);
  await admin.from('lead_duplicates').update({ status: 'merged' }).eq('id', duplicateId);
  await admin.from('duplicate_resolution_events').insert({
    tenant_id: ctx.activeTenantId,
    primary_lead_id: primaryId,
    merged_lead_id: mergedId,
    action: 'merge',
    source_precedence: opts?.sourcePrecedence ?? null,
    commission_exposure: opts?.commissionExposure ?? null,
    snapshot: (snapshot as Record<string, unknown>) ?? {},
    resolved_by: ctx.userId,
  });
  await writeAudit({
    action: 'LEAD_MERGE',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'lead',
    entityId: primaryId,
    newValues: { primaryId, mergedId, reversible: true },
  });

  revalidatePath('/leads/duplicates');
  revalidatePath('/leads');
  return { ok: true };
}
