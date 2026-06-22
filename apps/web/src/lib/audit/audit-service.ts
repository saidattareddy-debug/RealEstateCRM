import 'server-only';
import {
  AUDIT_ACTIONS,
  redactSensitive,
  type AuditActionName,
  type SecuritySeverity,
} from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getRequestContext } from './request-context';

/**
 * Server-side audit-writing service. Uses the service-role client (bypasses
 * RLS) and is the ONLY writer of audit_logs / security_events. Sensitive keys
 * (passwords, tokens, secrets) are redacted before storage. Never throws into
 * the caller's critical path — audit failures are logged, not surfaced.
 * See docs/AUDIT_LOGGING.md.
 */

export interface WriteAuditInput {
  action: AuditActionName;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorMembershipId?: string | null;
  actorRole?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  previousValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
  /** Override the default severity when this action raises a security event. */
  severity?: SecuritySeverity;
}

const DEFAULT_SEVERITY: Partial<Record<AuditActionName, SecuritySeverity>> = {
  SIGN_IN_FAILURE: 'medium',
  TENANT_SWITCH_DENIED: 'medium',
  ROLE_CHANGE: 'high',
  PERMISSION_OVERRIDE: 'high',
  IMPERSONATION_START: 'high',
  IMPERSONATION_END: 'high',
  EXPORT_REQUEST: 'medium',
  INTEGRATION_CONFIG_CHANGE: 'high',
};

export async function writeAudit(input: WriteAuditInput): Promise<void> {
  const def = AUDIT_ACTIONS[input.action];
  try {
    const ctx = await getRequestContext();
    const admin = createSupabaseAdminClient();

    const { error } = await admin.from('audit_logs').insert({
      tenant_id: input.tenantId ?? null,
      actor_user_id: input.actorUserId ?? null,
      actor_membership_id: input.actorMembershipId ?? null,
      actor_role: input.actorRole ?? null,
      action: def.key,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      previous_values: input.previousValues ? redactSensitive(input.previousValues) : null,
      new_values: input.newValues ? redactSensitive(input.newValues) : null,
      metadata: redactSensitive(input.metadata ?? {}),
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      request_id: ctx.requestId,
      correlation_id: ctx.correlationId,
    });
    if (error) console.error('[audit] failed to write audit_log', def.key, error.message);

    if (def.security) {
      await recordSecurityEvent({
        action: input.action,
        tenantId: input.tenantId ?? null,
        actorUserId: input.actorUserId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        severity: input.severity ?? DEFAULT_SEVERITY[input.action] ?? 'medium',
        metadata: input.metadata,
      });
    }
  } catch (e) {
    console.error('[audit] writeAudit error', def.key, (e as Error).message);
  }
}

interface RecordSecurityEventInput {
  action: AuditActionName;
  tenantId: string | null;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: SecuritySeverity;
  metadata?: Record<string, unknown>;
}

/** Upsert-by-dedupe: increment an existing open event or insert a new one. */
export async function recordSecurityEvent(input: RecordSecurityEventInput): Promise<void> {
  const def = AUDIT_ACTIONS[input.action];
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from('security_events')
    .select('id, occurrence_count')
    .eq('action', def.key)
    .is('resolved_by', null)
    .in('status', ['open', 'investigating'])
    .eq('tenant_id', input.tenantId as string)
    .eq('entity_type', input.entityType as string)
    .eq('entity_id', input.entityId as string)
    .maybeSingle();

  if (existing) {
    await admin
      .from('security_events')
      .update({
        occurrence_count: (existing.occurrence_count as number) + 1,
        last_detected_at: new Date().toISOString(),
      })
      .eq('id', existing.id as string);
    return;
  }

  await admin.from('security_events').insert({
    tenant_id: input.tenantId,
    action: def.key,
    category: def.category,
    severity: input.severity,
    actor_user_id: input.actorUserId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    metadata: redactSensitive(input.metadata ?? {}),
  });
}
