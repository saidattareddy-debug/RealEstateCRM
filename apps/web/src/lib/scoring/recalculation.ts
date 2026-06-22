import 'server-only';
import { SyncLocalDriver, registerProcessor, type JobRecord } from '@/lib/jobs';
import { runLeadScore, type ScoreTrigger } from './score-service';

/**
 * Phase 6A — score recalculation via the durable-job abstraction (RECORD-ONLY).
 *
 * Recalculation is enqueued as a durable job and executed through the score
 * service, which never mutates a lead's stage/assignment/status/conversation and
 * never sends. Idempotency: the correlation id is derived from the lead + trigger
 * + a stable bucket so duplicate enqueues for the same logical event collapse;
 * re-running the score is itself safe (a fresh immutable run is appended, never
 * overwriting prior runs). The spec's recalculation triggers are enumerated in
 * `RECALCULATION_TRIGGERS`.
 */

export const SCORE_RECALC_JOB = 'scoring.recalculate';

/** Triggers that may enqueue a recalculation (spec trigger list). */
export const RECALCULATION_TRIGGERS: readonly ScoreTrigger[] = [
  'manual',
  'recalculation',
  'observation_recorded',
  'model_activated',
  'extraction_approved',
] as const;

interface RecalcPayload {
  leadId: string;
  tenantId: string;
  trigger: ScoreTrigger;
  actorUserId: string | null;
}

let registered = false;

/** Register the recalculation processor once (idempotent). */
export function ensureRecalcProcessorRegistered(): void {
  if (registered) return;
  registerProcessor({
    type: SCORE_RECALC_JOB,
    async handle(job: JobRecord) {
      const p = job.payload as unknown as RecalcPayload;
      if (!p.leadId || !p.tenantId) return;
      // The score service is record-only; a failed run just retries via the queue.
      await runLeadScore(
        p.leadId,
        p.tenantId,
        p.trigger ?? 'recalculation',
        undefined,
        p.actorUserId,
      );
    },
  });
  registered = true;
}

export interface EnqueueRecalcInput {
  leadId: string;
  tenantId: string;
  trigger: ScoreTrigger;
  actorUserId?: string | null;
  /** Optional stable bucket for idempotent collapse (e.g. an event id). */
  idempotencyKey?: string;
}

/**
 * Enqueue a lead-score recalculation. Uses the sync-local driver so the work
 * runs in-request in dev; on live Supabase the same call enqueues to the durable
 * outbox drained by a worker. Returns the job id.
 */
export async function enqueueRecalculation(input: EnqueueRecalcInput): Promise<{ jobId: string }> {
  ensureRecalcProcessorRegistered();
  const correlationId = `score:${input.tenantId}:${input.leadId}:${input.idempotencyKey ?? input.trigger}`;
  return SyncLocalDriver.enqueue({
    tenantId: input.tenantId,
    jobType: SCORE_RECALC_JOB,
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
