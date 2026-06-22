import 'server-only';
import { createHash } from 'node:crypto';
import {
  normalizePhone,
  findDuplicates,
  assignLead,
  decideAfterFailure,
  type ContactKey,
  type Agent,
} from '@re/domain';
import type { LeadInput } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';

export type SourceKind =
  | 'form'
  | 'csv'
  | 'manual'
  | 'api'
  | 'webhook'
  | 'whatsapp'
  | 'portal'
  | 'email'
  | 'ad';

export interface IngestOptions {
  actorUserId?: string | null;
  sourceKind?: SourceKind;
  /** Stable key for idempotency; defaults to externalEventId, else a payload hash. */
  idempotencyKey?: string;
  /** Provider event id (e.g. Meta lead id) for cross-tenant-safe dedupe. */
  externalEventId?: string | null;
  correlationId?: string;
}

export interface IngestResult {
  leadId: string;
  duplicates: number;
  assignedAgentId: string | null;
  /** True when this payload was already ingested (no new lead created). */
  idempotentHit?: boolean;
  eventId?: string;
  status?: 'completed' | 'rejected';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * Idempotent, persist-before-process lead ingestion (MASTER_SPEC §8, §29).
 * Records a durable lead_ingestion_event keyed by (tenant, idempotency_key)
 * BEFORE doing any work. Repeated or concurrent submissions of the same payload
 * never create duplicate leads/assignments/attribution/duplicates/audit — the
 * unique constraint makes the second insert a no-op and the existing result is
 * returned. The same key with a *different* payload is rejected.
 */
export async function ingestLead(
  tenantId: string,
  input: LeadInput,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const admin = createSupabaseAdminClient();
  const payloadHash = canonicalHash(input);
  const externalEventId = opts.externalEventId ?? input.sourceLeadId ?? null;
  const idempotencyKey = opts.idempotencyKey ?? externalEventId ?? payloadHash;
  const correlationId = opts.correlationId ?? crypto.randomUUID();
  const sourceKind = opts.sourceKind ?? 'manual';

  // Resolve/create the source row up-front so the event can reference it.
  const sourceId = await resolveSourceId(admin, tenantId, sourceKind, input.source ?? null);

  // 1) Persist the ingestion event (the durable copy) — idempotent on (tenant,key).
  const { data: inserted, error: insErr } = await admin
    .from('lead_ingestion_events')
    .insert({
      tenant_id: tenantId,
      source_id: sourceId,
      external_event_id: externalEventId,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      original_payload: input as unknown as Record<string, unknown>,
      status: 'received',
      correlation_id: correlationId,
    })
    .select('id')
    .single();

  if (insErr) {
    // Unique violation => this payload/key was already received.
    if (insErr.code === '23505') {
      const { data: existing } = await admin
        .from('lead_ingestion_events')
        .select('id, payload_hash, status, resulting_lead_id')
        .eq('tenant_id', tenantId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing && existing.payload_hash !== payloadHash) {
        return {
          leadId: '',
          duplicates: 0,
          assignedAgentId: null,
          idempotentHit: true,
          eventId: existing.id as string,
          status: 'rejected',
        };
      }
      return {
        leadId: (existing?.resulting_lead_id as string) ?? '',
        duplicates: 0,
        assignedAgentId: null,
        idempotentHit: true,
        eventId: existing?.id as string,
        status: 'completed',
      };
    }
    throw new Error(`ingestion event persist failed: ${insErr.message}`);
  }

  const eventId = inserted.id as string;
  await admin
    .from('lead_ingestion_events')
    .update({ status: 'processing', attempt_count: 1 })
    .eq('id', eventId);
  await admin.from('lead_ingestion_attempts').insert({
    tenant_id: tenantId,
    event_id: eventId,
    attempt_no: 1,
    status: 'processing',
  });

  // 2) Process (sync local driver). Swap to PGMQ worker on live Supabase.
  try {
    const result = await processLead(admin, tenantId, input, {
      sourceKind,
      sourceId,
      actorUserId: opts.actorUserId ?? null,
      correlationId,
    });
    await admin
      .from('lead_ingestion_events')
      .update({
        status: 'completed',
        resulting_lead_id: result.leadId,
        normalized_payload: { phone: normalizePhone(input.phone ?? null) },
        completed_at: new Date().toISOString(),
      })
      .eq('id', eventId);
    await admin
      .from('lead_ingestion_attempts')
      .update({ status: 'completed', finished_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .eq('attempt_no', 1);
    await admin
      .from('idempotency_keys')
      .insert({
        tenant_id: tenantId,
        scope: 'lead_ingest',
        idem_key: idempotencyKey,
        payload_hash: payloadHash,
        lead_id: result.leadId,
        status: 'completed',
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return { ...result, eventId, status: 'completed' };
  } catch (e) {
    const message = (e as Error).message?.slice(0, 300) ?? 'error';
    const decision = decideAfterFailure(1);
    if (decision.action === 'dead_letter') {
      await admin
        .from('lead_ingestion_events')
        .update({ status: 'dead_letter', last_error_code: 'process_error', error_summary: message })
        .eq('id', eventId);
      await admin.from('dead_letter_events').insert({
        tenant_id: tenantId,
        origin: 'ingestion',
        origin_id: eventId,
        job_type: 'lead_ingest',
        payload: input as unknown as Record<string, unknown>,
        error: message,
        correlation_id: correlationId,
      });
    } else {
      await admin
        .from('lead_ingestion_events')
        .update({
          status: 'retry_scheduled',
          next_retry_at: decision.nextRetryAt.toISOString(),
          last_error_code: 'process_error',
          error_summary: message,
        })
        .eq('id', eventId);
    }
    await admin
      .from('lead_ingestion_attempts')
      .update({
        status: 'retry_scheduled',
        error_code: 'process_error',
        error_summary: message,
        finished_at: new Date().toISOString(),
      })
      .eq('event_id', eventId)
      .eq('attempt_no', 1);
    throw new Error(message);
  }
}

async function resolveSourceId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  sourceKind: SourceKind,
  sourceName: string | null,
): Promise<string | null> {
  const { data: src } = await admin
    .from('lead_sources')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kind', sourceKind)
    .limit(1)
    .maybeSingle();
  if (src) return src.id as string;
  const { data: created } = await admin
    .from('lead_sources')
    .insert({ tenant_id: tenantId, name: sourceName ?? sourceKind, kind: sourceKind })
    .select('id')
    .maybeSingle();
  return (created?.id as string) ?? null;
}

interface ProcessOptions {
  sourceKind: SourceKind;
  sourceId: string | null;
  actorUserId: string | null;
  correlationId: string;
}

/** The actual create-or-merge work. Idempotency is enforced by the caller. */
async function processLead(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  input: LeadInput,
  opts: ProcessOptions,
): Promise<IngestResult> {
  const phone = normalizePhone(input.phone ?? null);
  const sourceKind = opts.sourceKind;
  const sourceId = opts.sourceId;

  // Default "New" stage of the default pipeline.
  const { data: stage } = await admin
    .from('pipeline_stages')
    .select('id, pipelines!inner(tenant_id, is_default)')
    .eq('pipelines.tenant_id', tenantId)
    .eq('pipelines.is_default', true)
    .eq('sort_order', 1)
    .maybeSingle();

  // Dedupe against existing tenant leads.
  const { data: existingRows } = await admin
    .from('leads')
    .select(
      'id, full_name, primary_phone_e164, primary_phone_national, primary_email, campaign, created_at, lead_sources(kind)',
    )
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  // Broker/direct overlap: third-party (portal/ad) vs direct (form/manual/whatsapp).
  const THIRD_PARTY = new Set(['portal', 'ad']);
  const incomingThirdParty = THIRD_PARTY.has(sourceKind);
  const existingKindById = new Map<string, string>();
  for (const r of existingRows ?? []) {
    const k = (r.lead_sources as unknown as { kind: string } | null)?.kind;
    if (k) existingKindById.set(r.id as string, k);
  }

  const incoming: ContactKey = {
    id: 'incoming',
    fullName: input.fullName ?? null,
    phoneE164: phone.e164,
    phoneNational: phone.national,
    email: input.email ?? null,
    campaign: input.campaign ?? null,
    source: input.source ?? sourceKind,
    sourceLeadId: input.sourceLeadId ?? null,
    createdAt: new Date().toISOString(),
  };
  const existing: ContactKey[] = (existingRows ?? []).map((r) => ({
    id: r.id as string,
    fullName: (r.full_name as string | null) ?? null,
    phoneE164: (r.primary_phone_e164 as string | null) ?? null,
    phoneNational: (r.primary_phone_national as string | null) ?? null,
    email: (r.primary_email as string | null) ?? null,
    campaign: (r.campaign as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
  const duplicates = findDuplicates(incoming, existing);

  // Create the lead.
  const { data: lead, error } = await admin
    .from('leads')
    .insert({
      tenant_id: tenantId,
      full_name: input.fullName ?? null,
      primary_phone_e164: phone.e164,
      primary_phone_national: phone.national,
      primary_email: input.email ?? null,
      preferred_language: input.preferredLanguage ?? null,
      campaign: input.campaign ?? null,
      utm: input.utm ?? {},
      operational_status: 'new',
      stage_id: (stage?.id as string) ?? null,
      source_id: sourceId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`lead insert failed: ${error.message}`);
  const leadId = lead.id as string;

  // Source event + first/last attribution touchpoints.
  await admin.from('lead_source_events').insert({
    tenant_id: tenantId,
    lead_id: leadId,
    source_id: sourceId,
    raw: input as unknown as Record<string, unknown>,
  });
  await admin.from('attribution_touchpoints').insert([
    {
      tenant_id: tenantId,
      lead_id: leadId,
      touch_type: 'first',
      source: incoming.source,
      campaign: incoming.campaign,
      utm: input.utm ?? {},
    },
    {
      tenant_id: tenantId,
      lead_id: leadId,
      touch_type: 'last',
      source: incoming.source,
      campaign: incoming.campaign,
      utm: input.utm ?? {},
    },
  ]);

  // Flag duplicates for review (never silently merge). Mark broker/direct
  // overlap when the matched lead came from the opposite source side.
  if (duplicates.length > 0) {
    await admin.from('lead_duplicates').insert(
      duplicates.map((d) => {
        const existingKind = existingKindById.get(d.leadId);
        const existingThirdParty = existingKind ? THIRD_PARTY.has(existingKind) : false;
        return {
          tenant_id: tenantId,
          lead_id: leadId,
          duplicate_lead_id: d.leadId,
          confidence: d.confidence,
          signals: d.signals,
          is_broker_conflict: incomingThirdParty !== existingThirdParty,
        };
      }),
    );

    // Append a LAST-touch attribution to the strongest matched existing lead —
    // its FIRST-touch row is never modified (MASTER_SPEC §8, attribution).
    await admin.from('attribution_touchpoints').insert({
      tenant_id: tenantId,
      lead_id: duplicates[0]!.leadId,
      touch_type: 'last',
      source: incoming.source,
      campaign: incoming.campaign,
      utm: input.utm ?? {},
    });
  }

  // Auto-assign to an eligible sales agent.
  const assignedAgentId = await autoAssign(
    admin,
    tenantId,
    leadId,
    input.preferredLanguage ?? null,
    opts.actorUserId ?? null,
  );

  await writeAudit({
    action: 'LEAD_CREATE',
    tenantId,
    actorUserId: opts.actorUserId ?? null,
    entityType: 'lead',
    entityId: leadId,
    newValues: { source: sourceKind, duplicates: duplicates.length },
  });

  return { leadId, duplicates: duplicates.length, assignedAgentId };
}

async function autoAssign(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  leadId: string,
  language: string | null,
  actorUserId: string | null,
): Promise<string | null> {
  const { data: members } = await admin
    .from('memberships')
    .select('profile_id, roles!inner(slug)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .eq('roles.slug', 'sales_agent');
  if (!members || members.length === 0) return null;

  const agentIds = members.map((m) => m.profile_id as string);
  const { data: loads } = await admin
    .from('lead_assignments')
    .select('agent_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('agent_id', agentIds);
  const loadByAgent = new Map<string, number>();
  for (const r of loads ?? []) {
    const a = r.agent_id as string;
    loadByAgent.set(a, (loadByAgent.get(a) ?? 0) + 1);
  }

  const agents: Agent[] = agentIds.map((id, i) => ({
    id,
    available: true,
    languages: [],
    activeLeadCount: loadByAgent.get(id) ?? 0,
    maxActiveLeads: 100,
    projectIds: [],
    roundRobinPosition: i,
  }));

  const result = assignLead({ language }, agents);
  if (!result) return null;

  await admin.from('lead_assignments').insert({
    tenant_id: tenantId,
    lead_id: leadId,
    agent_id: result.agentId,
    is_manual: false,
    active: true,
    reason: result.reason,
    assigned_by: actorUserId,
  });
  await writeAudit({
    action: 'LEAD_ASSIGN',
    tenantId,
    actorUserId,
    entityType: 'lead',
    entityId: leadId,
    newValues: { agentId: result.agentId, reason: result.reason, auto: true },
  });
  return result.agentId;
}
