import 'server-only';
import { SyncLocalDriver, registerProcessor, type JobRecord } from '@/lib/jobs';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runLeadMatch, type MatchTrigger } from './match-service';

/**
 * Phase 6B — match recalculation via the durable-job abstraction (ADVISORY).
 *
 * Recalculation is enqueued as a durable job and executed through the match
 * service, which never mutates a lead's stage/assignment/status/score/inventory
 * and never sends. Idempotency: the correlation id is derived from the lead +
 * trigger + a stable bucket so duplicate enqueues for the same logical event
 * collapse (no recalculation storms); re-running is itself safe (a fresh
 * immutable run is appended, never overwriting prior runs). The spec's
 * recalculation triggers are enumerated in `RECALCULATION_TRIGGERS`.
 *
 * The system-triggered processor uses the service-role client (tenant-scoped at
 * the query level); per-user project visibility only governs what a USER sees on
 * the lead panel, which is enforced by RLS at READ time on the persisted run.
 */

export const MATCH_RECALC_JOB = 'matching.recalculate';

/** Triggers that may enqueue a recalculation (spec trigger list). */
export const RECALCULATION_TRIGGERS: readonly MatchTrigger[] = [
  'manual',
  'recalculation',
  'preference_changed',
  'inventory_changed',
  'model_activated',
  'extraction_approved',
] as const;

interface RecalcPayload {
  leadId: string;
  tenantId: string;
  trigger: MatchTrigger;
  actorUserId: string | null;
}

let registered = false;

/** Register the recalculation processor once (idempotent). */
export function ensureMatchRecalcProcessorRegistered(): void {
  if (registered) return;
  registerProcessor({
    type: MATCH_RECALC_JOB,
    async handle(job: JobRecord) {
      const p = job.payload as unknown as RecalcPayload;
      if (!p.leadId || !p.tenantId) return;
      // The match service is advisory; a failed run just retries via the queue.
      await runLeadMatch(
        p.leadId,
        p.tenantId,
        p.trigger ?? 'recalculation',
        createSupabaseAdminClient(),
        p.actorUserId,
      );
    },
  });
  registered = true;
}

export interface EnqueueMatchRecalcInput {
  leadId: string;
  tenantId: string;
  trigger: MatchTrigger;
  actorUserId?: string | null;
  /** Optional stable bucket for idempotent collapse (e.g. an event id). */
  idempotencyKey?: string;
}

/**
 * Enqueue a lead-match recalculation. Uses the sync-local driver so the work
 * runs in-request in dev; on live Supabase the same call enqueues to the durable
 * outbox drained by a worker. Returns the job id.
 */
export async function enqueueMatchRecalculation(
  input: EnqueueMatchRecalcInput,
): Promise<{ jobId: string }> {
  ensureMatchRecalcProcessorRegistered();
  const correlationId = `match:${input.tenantId}:${input.leadId}:${input.idempotencyKey ?? input.trigger}`;
  return SyncLocalDriver.enqueue({
    tenantId: input.tenantId,
    jobType: MATCH_RECALC_JOB,
    payload: {
      leadId: input.leadId,
      tenantId: input.tenantId,
      trigger: input.trigger,
      actorUserId: input.actorUserId ?? null,
    },
    correlationId,
    maxAttempts: 5,
  });
}
