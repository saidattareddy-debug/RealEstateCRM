import 'server-only';
import type { EnqueueInput, JobDriver } from './types';
import { enqueueJob, drainJobs } from './repository';

export * from './types';
export { registerProcessor, enqueueJob, drainJobs, replayDeadLetter } from './repository';

/**
 * SyncLocalDriver — enqueues to the durable outbox, then immediately drains so
 * the work happens within the current request. Use in local/dev. NOT a
 * production background worker; the outbox row remains the durable copy.
 */
export const SyncLocalDriver: JobDriver = {
  async enqueue(input: EnqueueInput) {
    const res = await enqueueJob(input);
    await drainJobs(1);
    return res;
  },
  async drain(limit?: number) {
    return drainJobs(limit);
  },
};

/**
 * OutboxDriver — enqueues only; a separate cron/worker (or CI) calls drain().
 * This is the shape a PGMQ-backed driver will take on live Supabase.
 */
export const OutboxDriver: JobDriver = {
  async enqueue(input: EnqueueInput) {
    return enqueueJob(input);
  },
  async drain(limit?: number) {
    return drainJobs(limit);
  },
};

/**
 * PgmqDriver — interface placeholder for the deferred live driver. Throws until
 * PGMQ + a worker are provisioned on Supabase; the call sites are driver-agnostic.
 */
export const PgmqDriver: JobDriver = {
  async enqueue() {
    throw new Error('PgmqDriver not available until live Supabase + PGMQ are provisioned');
  },
  async drain() {
    throw new Error('PgmqDriver not available until live Supabase + PGMQ are provisioned');
  },
};
