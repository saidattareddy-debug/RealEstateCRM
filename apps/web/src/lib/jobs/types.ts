/**
 * Durable-workflow abstraction (MASTER_SPEC §29). The app depends only on these
 * interfaces; the concrete driver is swappable: SyncLocalDriver (now),
 * OutboxDriver (now, drained by cron/worker), PgmqDriver (deferred to live
 * Supabase). No driver is a "production background worker" by itself — the
 * outbox row is the durable copy.
 */

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retry_scheduled'
  | 'dead_letter'
  | 'cancelled';

export interface EnqueueInput {
  tenantId: string | null;
  jobType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  maxAttempts?: number;
}

export interface JobRecord {
  id: string;
  tenantId: string | null;
  jobType: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

/** A unit of work keyed by job type. Implementations must be idempotent. */
export interface JobProcessor {
  type: string;
  handle(job: JobRecord): Promise<void>;
}

/** Pluggable transport. */
export interface JobDriver {
  /** Persist the job (the durable copy) and return its id. */
  enqueue(input: EnqueueInput): Promise<{ jobId: string }>;
  /** Drain ready jobs through registered processors (sync/outbox only). */
  drain(limit?: number): Promise<{ processed: number; failed: number; deadLettered: number }>;
}
