import 'server-only';
import { computeHealthState, type HealthState, type IntegrationStatus } from '@re/domain';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Recompute and persist the health state for a connection from durable signals
 * (status, configured, failures, dead-letters, token/subscription expiry). Pure
 * decision lives in `computeHealthState`; this only reads facts + records the
 * derived state. No external IO.
 */
export async function recomputeConnectionHealth(
  admin: Admin,
  tenantId: string,
  connectionId: string,
  opts: { actorUserId?: string | null; now?: Date } = {},
): Promise<HealthState | null> {
  const now = opts.now ?? new Date();

  const { data: conn } = await admin
    .from('integration_connections')
    .select('status, health_state, last_success_at')
    .eq('tenant_id', tenantId)
    .eq('id', connectionId)
    .maybeSingle();
  if (!conn) return null;

  // Configured == an active connection version exists.
  const { count: versionCount } = await admin
    .from('integration_connection_versions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('connection_id', connectionId)
    .eq('active', true);

  const { data: cred } = await admin
    .from('integration_credentials_metadata')
    .select('expires_at')
    .eq('tenant_id', tenantId)
    .eq('connection_id', connectionId)
    .order('expires_at', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Consecutive recent failures (failed events since the last success).
  const { count: deadLetterCount } = await admin
    .from('external_event_dead_letters')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const { data: recentEvents } = await admin
    .from('external_events')
    .select('status, received_at')
    .eq('tenant_id', tenantId)
    .eq('connection_id', connectionId)
    .order('received_at', { ascending: false })
    .limit(20);
  let consecutiveFailures = 0;
  for (const e of recentEvents ?? []) {
    const s = e.status as string;
    if (s === 'failed' || s === 'dead_letter') consecutiveFailures += 1;
    else if (s === 'processed' || s === 'duplicate') break;
  }

  const next = computeHealthState({
    status: conn.status as IntegrationStatus,
    configured: (versionCount ?? 0) > 0,
    lastSuccessAt: (conn.last_success_at as string | null) ?? undefined,
    consecutiveFailures,
    tokenExpiresAt: (cred?.expires_at as string | null) ?? undefined,
    deadLetterCount: deadLetterCount ?? 0,
    now,
  });

  const prev = conn.health_state as HealthState;
  if (prev === next) return next;

  await admin
    .from('integration_connections')
    .update({ health_state: next, updated_at: now.toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', connectionId);
  await admin.from('integration_health_events').insert({
    tenant_id: tenantId,
    connection_id: connectionId,
    health_state: next,
    detail: `recomputed: ${prev} -> ${next}`,
  });
  await writeAudit({
    action: 'INTEGRATION_HEALTH_CHANGED',
    tenantId,
    actorUserId: opts.actorUserId ?? null,
    entityType: 'integration_connection',
    entityId: connectionId,
    metadata: { from: prev, to: next },
  });
  return next;
}
