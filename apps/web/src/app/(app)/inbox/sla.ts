'use server';

import {
  addWorkingMinutes,
  standardWeek,
  resolveSlaPolicy,
  computeSlaStatus,
  deriveSlaEvents,
  type SlaPolicyRow,
  type SlaSnapshot,
  type SlaStatus,
} from '@re/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAppContext } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const CLOSED_LIFECYCLES = new Set(['resolved', 'closed', 'archived', 'spam']);

/**
 * Core recompute (client + tenant injected). Deterministic: policy precedence
 * via `resolveSlaPolicy`, due time via the working-hours engine, event set via
 * `deriveSlaEvents`. Only real timestamps are written — no fabricated metrics.
 */
async function runRecompute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  tenantId: string,
  conversationId: string,
  opts: { reason: string; correlationId?: string },
): Promise<void> {
  const { data: conv } = await supabase
    .from('conversations')
    .select(
      'id, channel, priority, status, waiting_on, first_response_at, first_response_due_at, last_inbound_at, sla_status',
    )
    .eq('id', conversationId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!conv) return;

  const { data: policyRows } = await supabase
    .from('conversation_sla_policies')
    .select(
      'id, project_id, channel, priority, first_response_minutes, next_response_minutes, active',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const policies: SlaPolicyRow[] = (policyRows ?? []).map((p) => ({
    id: p.id as string,
    projectId: (p.project_id as string | null) ?? null,
    channel: (p.channel as string | null) ?? null,
    priority: (p.priority as string | null) ?? null,
    firstResponseMinutes: (p.first_response_minutes as number) ?? 15,
    nextResponseMinutes: (p.next_response_minutes as number) ?? 60,
    workingHours: null,
    active: Boolean(p.active),
  }));

  const policy = resolveSlaPolicy(policies, {
    projectId: null,
    channel: String(conv.channel),
    priority: String(conv.priority ?? 'normal'),
  });
  const firstResponseMinutes = policy?.firstResponseMinutes ?? 15;
  const wh = standardWeek(0);

  const lastInbound = conv.last_inbound_at as string | null;
  const firstResponseAt = conv.first_response_at as string | null;
  const lifecycle = String(conv.status);
  const closed = CLOSED_LIFECYCLES.has(lifecycle);

  const dueAt =
    lastInbound && !firstResponseAt
      ? addWorkingMinutes(new Date(lastInbound), firstResponseMinutes, wh).toISOString()
      : ((conv.first_response_due_at as string | null) ?? null);

  const status: SlaStatus = computeSlaStatus({
    dueAt,
    firstResponseAt,
    lifecycle: lifecycle as never,
    waitingOn: String(conv.waiting_on ?? 'none') as never,
    now: new Date(),
  });

  const prevStored = conv.sla_status as string | null;
  const prev: SlaSnapshot | null = prevStored
    ? {
        dueAt: (conv.first_response_due_at as string | null) ?? null,
        status: prevStored as SlaStatus,
        firstResponded: Boolean(firstResponseAt),
        closed,
      }
    : null;
  const next: SlaSnapshot = { dueAt, status, firstResponded: Boolean(firstResponseAt), closed };

  const events = deriveSlaEvents(prev, next);
  if (events.length > 0) {
    await supabase.from('conversation_sla_events').insert(
      events.map((e) => ({
        tenant_id: tenantId,
        conversation_id: conversationId,
        policy_id: policy?.id ?? null,
        kind: e.kind,
        due_at: e.dueAt,
        previous_due_at: e.previousDueAt,
        reason: opts.reason,
        correlation_id: opts.correlationId ?? null,
      })),
    );
  }

  if (status !== prevStored || dueAt !== (conv.first_response_due_at as string | null)) {
    await supabase
      .from('conversations')
      .update({ sla_status: status, first_response_due_at: dueAt })
      .eq('id', conversationId)
      .eq('tenant_id', tenantId);
  }
}

/** Recompute under the caller's RLS session (used by agent-side actions). */
export async function recomputeSla(
  conversationId: string,
  opts: { reason: string; correlationId?: string },
): Promise<void> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return;
  const supabase = await createSupabaseServerClient();
  await runRecompute(supabase, ctx.activeTenantId, conversationId, opts);
}

/**
 * Recompute from a trusted server context (used by the public inbound-message
 * route, which has the tenant id but no agent session). Tenant-scoped.
 */
export async function recomputeSlaAdmin(
  conversationId: string,
  tenantId: string,
  opts: { reason: string; correlationId?: string },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await runRecompute(admin, tenantId, conversationId, opts);
}
