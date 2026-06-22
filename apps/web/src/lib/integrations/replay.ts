import 'server-only';
import { decideReplay } from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { reprocessExternalEvent } from './ingest';

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export interface ReplayInput {
  tenantId: string;
  actorUserId: string;
  hasPermission: boolean;
  eventId: string;
  reason: string;
}

export interface ReplayResult {
  ok: boolean;
  reason: string;
  replayId?: string;
}

/**
 * Dead-letter a failed event (record-only). Moves a failed/processing event into
 * the dead-letter table so an operator can review and replay it. No external IO.
 */
export async function deadLetterEvent(
  admin: Admin,
  tenantId: string,
  eventId: string,
  reason: string,
  actorUserId?: string | null,
): Promise<boolean> {
  const { data: ev } = await admin
    .from('external_events')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return false;
  await admin
    .from('external_events')
    .update({ status: 'dead_letter' })
    .eq('tenant_id', tenantId)
    .eq('id', eventId);
  await admin
    .from('external_event_dead_letters')
    .insert({ tenant_id: tenantId, event_id: eventId, reason });
  await writeAudit({
    action: 'INTEGRATION_EVENT_DEAD_LETTERED',
    tenantId,
    actorUserId: actorUserId ?? null,
    entityType: 'external_event',
    entityId: eventId,
    metadata: { reason },
  });
  return true;
}

/**
 * Request a replay of a dead-lettered/failed event. Uses `decideReplay`
 * (permission, reason, event exists, not-already-succeeded). A replay records a
 * durable replay request; it does NOT re-run side effects inline. Because the
 * original `external_events` idempotency key is unchanged, any reprocessing keeps
 * the same idempotency protection and cannot duplicate a successful side effect.
 */
export async function requestReplay(input: ReplayInput): Promise<ReplayResult> {
  const admin = createSupabaseAdminClient();
  const { tenantId } = input;

  const { data: ev } = await admin
    .from('external_events')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('id', input.eventId)
    .maybeSingle();

  const decision = decideReplay({
    hasPermission: input.hasPermission,
    reasonProvided: Boolean(input.reason && input.reason.trim().length > 0),
    originalEventExists: Boolean(ev),
    alreadySucceeded: (ev?.status as string) === 'processed',
  });
  if (!decision.allow) return { ok: false, reason: decision.reason };

  const { data: replay, error } = await admin
    .from('external_event_replays')
    .insert({
      tenant_id: tenantId,
      event_id: input.eventId,
      requested_by: input.actorUserId,
      reason: input.reason,
      state: 'requested',
    })
    .select('id')
    .single();
  if (error || !replay) return { ok: false, reason: 'persist_failed' };

  await writeAudit({
    action: 'INTEGRATION_EVENT_REPLAYED',
    tenantId,
    actorUserId: input.actorUserId,
    entityType: 'external_event',
    entityId: input.eventId,
    metadata: { replayId: replay.id as string, reason: input.reason },
  });
  return { ok: true, reason: decision.reason, replayId: replay.id as string };
}

export interface ReplayExecutionInput extends ReplayInput {
  adapterVersion?: string | null;
  mappingVersion?: string | null;
}
export interface ReplayExecutionResult extends ReplayResult {
  executed: boolean;
}

/**
 * LOCAL synchronous post-normalization replay EXECUTOR (job-abstraction style;
 * production PGMQ worker execution stays deferred). Loads the original event +
 * envelope, REJECTS parse failures (`resubmission_required` — the raw body was
 * never retained), enforces permission/reason/tenant scope, records a new
 * processing attempt + an `executed` replay row carrying the selected adapter +
 * mapping version, then re-routes the PRESERVED normalized event through the
 * original idempotency anchor (no duplicate downstream effects). Historical
 * attempts are append-only. No external IO.
 */
export async function executeReplay(input: ReplayExecutionInput): Promise<ReplayExecutionResult> {
  const admin = createSupabaseAdminClient();
  const { tenantId } = input;

  const { data: ev } = await admin
    .from('external_events')
    .select('id, status, envelope_id')
    .eq('tenant_id', tenantId)
    .eq('id', input.eventId)
    .maybeSingle();

  // Parse failures cannot be replayed (no normalized event / no retained body).
  if (ev?.envelope_id) {
    const { data: env } = await admin
      .from('external_event_envelopes')
      .select('processing_status')
      .eq('tenant_id', tenantId)
      .eq('id', ev.envelope_id)
      .maybeSingle();
    if ((env?.processing_status as string) === 'resubmission_required') {
      return { ok: false, reason: 'parse_failure_not_replayable', executed: false };
    }
  }

  // Allow replay after success too — the idempotency anchor guarantees no
  // duplicate side effects — so `alreadySucceeded` is intentionally not a denial.
  const decision = decideReplay({
    hasPermission: input.hasPermission,
    reasonProvided: Boolean(input.reason && input.reason.trim().length > 0),
    originalEventExists: Boolean(ev),
    alreadySucceeded: false,
  });
  if (!decision.allow) return { ok: false, reason: decision.reason, executed: false };

  // New processing attempt (append-only).
  await admin.from('external_event_attempts').insert({
    tenant_id: tenantId,
    event_id: input.eventId,
    attempt_no: 2,
    status: 'processing',
  });
  const { data: replay } = await admin
    .from('external_event_replays')
    .insert({
      tenant_id: tenantId,
      event_id: input.eventId,
      requested_by: input.actorUserId,
      reason: input.reason,
      adapter_version: input.adapterVersion ?? null,
      mapping_version: input.mappingVersion ?? null,
      state: 'executed',
    })
    .select('id')
    .single();

  let ok = true;
  let reason = 'replayed';
  try {
    const r = await reprocessExternalEvent(admin, tenantId, input.eventId);
    if (!r.ok) {
      ok = false;
      reason = r.reason ?? 'reprocess_failed';
    }
  } catch (e) {
    ok = false;
    reason = (e as Error).message?.slice(0, 200) ?? 'reprocess_error';
  }

  await admin.from('external_event_attempts').insert({
    tenant_id: tenantId,
    event_id: input.eventId,
    attempt_no: 3,
    status: ok ? 'processed' : 'failed',
  });
  if (ok) {
    await admin
      .from('external_events')
      .update({ status: 'processed' })
      .eq('tenant_id', tenantId)
      .eq('id', input.eventId);
  } else {
    await admin
      .from('external_events')
      .update({ status: 'failed' })
      .eq('tenant_id', tenantId)
      .eq('id', input.eventId);
  }
  await writeAudit({
    action: 'INTEGRATION_EVENT_REPLAYED',
    tenantId,
    actorUserId: input.actorUserId,
    entityType: 'external_event',
    entityId: input.eventId,
    metadata: { replayId: (replay?.id as string) ?? null, executed: true, ok, outcome: reason },
  });
  return { ok, reason, replayId: (replay?.id as string) ?? undefined, executed: true };
}
