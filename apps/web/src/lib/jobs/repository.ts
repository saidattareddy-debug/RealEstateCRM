import 'server-only';
import { decideAfterFailure } from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { EnqueueInput, JobProcessor, JobRecord, JobStatus } from './types';

/**
 * Outbox-backed job repository (service-role). Persists jobs to background_jobs,
 * drains them through registered processors, applies the retry policy, and
 * moves exhausted jobs to dead_letter_events. Manual replay re-enqueues.
 */

const processors = new Map<string, JobProcessor>();
export function registerProcessor(p: JobProcessor) {
  processors.set(p.type, p);
}

export async function enqueueJob(input: EnqueueInput): Promise<{ jobId: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('background_jobs')
    .insert({
      tenant_id: input.tenantId,
      job_type: input.jobType,
      payload: input.payload,
      status: 'pending',
      max_attempts: input.maxAttempts ?? 5,
      correlation_id: input.correlationId ?? crypto.randomUUID(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return { jobId: data.id as string };
}

function toRecord(row: Record<string, unknown>): JobRecord {
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string | null) ?? null,
    jobType: row.job_type as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as JobStatus,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    correlationId: (row.correlation_id as string | null) ?? null,
  };
}

/** Drain ready jobs (pending / retry_scheduled with next_run_at due). */
export async function drainJobs(limit = 25) {
  const admin = createSupabaseAdminClient();
  const { data: rows } = await admin
    .from('background_jobs')
    .select('*')
    .in('status', ['pending', 'retry_scheduled'])
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(limit);

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of rows ?? []) {
    const job = toRecord(row);
    const processor = processors.get(job.jobType);
    // Lock.
    await admin
      .from('background_jobs')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('id', job.id);

    if (!processor) {
      await admin
        .from('background_jobs')
        .update({ status: 'failed', last_error: 'no processor' })
        .eq('id', job.id);
      failed++;
      continue;
    }

    try {
      await processor.handle(job);
      await admin.from('background_jobs').update({ status: 'completed' }).eq('id', job.id);
      processed++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const decision = decideAfterFailure(attempts);
      const message = (e as Error).message?.slice(0, 500) ?? 'error';
      if (decision.action === 'dead_letter') {
        await admin
          .from('background_jobs')
          .update({ status: 'dead_letter', attempts, last_error: message })
          .eq('id', job.id);
        await admin.from('dead_letter_events').insert({
          tenant_id: job.tenantId,
          origin: 'job',
          origin_id: job.id,
          job_type: job.jobType,
          payload: job.payload,
          error: message,
          correlation_id: job.correlationId,
        });
        deadLettered++;
      } else {
        await admin
          .from('background_jobs')
          .update({
            status: 'retry_scheduled',
            attempts,
            next_run_at: decision.nextRetryAt.toISOString(),
            last_error: message,
          })
          .eq('id', job.id);
        failed++;
      }
    }
  }
  return { processed, failed, deadLettered };
}

/** Manual replay: re-enqueue from a dead-letter row. */
export async function replayDeadLetter(deadLetterId: string): Promise<{ jobId: string } | null> {
  const admin = createSupabaseAdminClient();
  const { data: dl } = await admin
    .from('dead_letter_events')
    .select('id, tenant_id, job_type, payload, correlation_id, replayed_at')
    .eq('id', deadLetterId)
    .maybeSingle();
  if (!dl || dl.replayed_at) return null;
  const res = await enqueueJob({
    tenantId: (dl.tenant_id as string | null) ?? null,
    jobType: dl.job_type as string,
    payload: (dl.payload as Record<string, unknown>) ?? {},
    correlationId: (dl.correlation_id as string | null) ?? undefined,
  });
  await admin
    .from('dead_letter_events')
    .update({ replayed_at: new Date().toISOString() })
    .eq('id', deadLetterId);
  return res;
}
