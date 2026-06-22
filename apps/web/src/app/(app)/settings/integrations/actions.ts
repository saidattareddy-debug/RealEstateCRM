'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { INTEGRATION_PROVIDERS } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { recomputeConnectionHealth } from '@/lib/integrations/health';
import { requestReplay } from '@/lib/integrations/replay';

type ActionResult = { ok?: boolean; error?: string; id?: string };

async function authManage() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'integrations.manage')) {
    return { error: 'You do not have permission to manage integrations.' as const };
  }
  return { ctx, tenantId: ctx.activeTenantId };
}

const createSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  displayName: z.string().min(1).max(120),
  integrationKind: z.string().min(1).max(60),
});

/** Create a DRAFT connection. Never `connected` (DB CHECK forbids it). */
export async function createDraftConnection(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a provider, kind and display name.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('integration_connections')
    .insert({
      tenant_id: tenantId,
      provider: parsed.data.provider,
      integration_kind: parsed.data.integrationKind,
      display_name: parsed.data.displayName,
      status: 'draft',
      health_state: 'unconfigured',
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create connection.' };

  await writeAudit({
    action: 'INTEGRATION_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: data.id as string,
    metadata: { provider: parsed.data.provider, kind: parsed.data.integrationKind },
  });
  revalidatePath('/settings/integrations');
  return { ok: true, id: data.id as string };
}

const configSchema = z.object({
  connectionId: z.string().uuid(),
  config: z.record(z.unknown()).default({}),
  allowedEventTypes: z.array(z.string()).default([]),
});

/** Save NON-SECRET configuration as a new active connection version. */
export async function configureConnection(
  input: z.infer<typeof configSchema>,
): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid configuration.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data: versions } = await supabase
    .from('integration_connection_versions')
    .select('version')
    .eq('tenant_id', tenantId)
    .eq('connection_id', parsed.data.connectionId)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = ((versions?.[0]?.version as number | undefined) ?? 0) + 1;

  // Deactivate previous active version, then insert the new active one.
  await supabase
    .from('integration_connection_versions')
    .update({ active: false })
    .eq('tenant_id', tenantId)
    .eq('connection_id', parsed.data.connectionId)
    .eq('active', true);
  const { error } = await supabase.from('integration_connection_versions').insert({
    tenant_id: tenantId,
    connection_id: parsed.data.connectionId,
    version: nextVersion,
    config: parsed.data.config,
    active: true,
  });
  if (error) return { error: error.message };

  await supabase
    .from('integration_connections')
    .update({
      allowed_event_types: parsed.data.allowedEventTypes,
      status: 'unconfigured',
      updated_by: ctx.userId,
    })
    .eq('tenant_id', tenantId)
    .eq('id', parsed.data.connectionId)
    .eq('status', 'draft');

  await writeAudit({
    action: 'INTEGRATION_UPDATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: parsed.data.connectionId,
    metadata: { version: nextVersion },
  });
  revalidatePath(`/settings/integrations/${parsed.data.connectionId}`);
  return { ok: true };
}

const secretRefSchema = z.object({
  connectionId: z.string().uuid(),
  credentialType: z.string().min(1).max(60),
  // A REFERENCE only (env-var name). Never a plaintext secret value.
  secretRef: z.string().regex(/^[A-Z0-9_]+$/, 'Use an env-var reference name (A–Z, 0–9, _).'),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** Record a secret REFERENCE + safe metadata. The secret value is never stored. */
export async function setSecretRef(input: z.infer<typeof secretRefSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'integrations.credentials.manage')) {
    return { error: 'You do not have permission to manage credentials.' };
  }
  const parsed = secretRefSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Provide a secret reference.' };
  }
  const tenantId = ctx.activeTenantId;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from('integration_credentials_metadata').upsert(
    {
      tenant_id: tenantId,
      connection_id: parsed.data.connectionId,
      credential_type: parsed.data.credentialType,
      secret_ref: parsed.data.secretRef,
      expires_at: parsed.data.expiresAt ?? null,
      verification_status: 'unverified',
    },
    { onConflict: 'connection_id,credential_type' },
  );
  if (error) return { error: error.message };

  await writeAudit({
    action: 'INTEGRATION_SECRET_REF_UPDATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: parsed.data.connectionId,
    // Audit the REFERENCE name only — never the resolved secret.
    metadata: { credentialType: parsed.data.credentialType, secretRef: parsed.data.secretRef },
  });
  revalidatePath(`/settings/integrations/${parsed.data.connectionId}`);
  return { ok: true };
}

/** Run a MOCK verification → moves the connection to `test` (never `connected`). */
export async function runMockVerification(connectionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(connectionId).success) return { error: 'Invalid connection.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  await writeAudit({
    action: 'INTEGRATION_VERIFICATION_ATTEMPTED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: connectionId,
  });

  // Mock verification always lands in `test` mode — there is no live provider.
  const { error } = await supabase
    .from('integration_connections')
    .update({ status: 'test', updated_by: ctx.userId })
    .eq('tenant_id', tenantId)
    .eq('id', connectionId)
    .neq('status', 'disabled');
  if (error) return { error: error.message };

  await writeAudit({
    action: 'INTEGRATION_VERIFICATION_SUCCEEDED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: connectionId,
    metadata: { result: 'mock_verified_test_mode' },
  });
  const admin = createSupabaseAdminClient();
  await recomputeConnectionHealth(admin, tenantId, connectionId, { actorUserId: ctx.userId });
  revalidatePath(`/settings/integrations/${connectionId}`);
  revalidatePath('/settings/integrations');
  return { ok: true };
}

/** Enable test mode (alias of mock verification for clarity in the UI). */
export async function enableTestMode(connectionId: string): Promise<ActionResult> {
  return runMockVerification(connectionId);
}

/** Disable a connection. */
export async function disableConnection(connectionId: string): Promise<ActionResult> {
  const auth = await authManage();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(connectionId).success) return { error: 'Invalid connection.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('integration_connections')
    .update({ status: 'disabled', disabled_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('tenant_id', tenantId)
    .eq('id', connectionId);
  if (error) return { error: error.message };

  await writeAudit({
    action: 'INTEGRATION_DISABLED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'integration_connection',
    entityId: connectionId,
  });
  const admin = createSupabaseAdminClient();
  await recomputeConnectionHealth(admin, tenantId, connectionId, { actorUserId: ctx.userId });
  revalidatePath(`/settings/integrations/${connectionId}`);
  revalidatePath('/settings/integrations');
  return { ok: true };
}

const mappingSchema = z.object({
  sourceRef: z.string().min(1).max(120),
  projectId: z.string().uuid().nullable().optional(),
  leadSource: z.string().max(60).nullable().optional(),
  channel: z.string().max(60).nullable().optional(),
});

/** Create a source mapping (mappings permission). */
export async function createSourceMapping(
  input: z.infer<typeof mappingSchema>,
): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'integrations.mappings.manage')) {
    return { error: 'You do not have permission to manage mappings.' };
  }
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a source reference.' };
  const tenantId = ctx.activeTenantId;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('external_source_mappings')
    .insert({
      tenant_id: tenantId,
      source_ref: parsed.data.sourceRef,
      project_id: parsed.data.projectId ?? null,
      lead_source: parsed.data.leadSource ?? null,
      channel: parsed.data.channel ?? null,
      version: 1,
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create mapping.' };

  await writeAudit({
    action: 'INTEGRATION_MAPPING_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'external_source_mapping',
    entityId: data.id as string,
    metadata: { sourceRef: parsed.data.sourceRef },
  });
  revalidatePath('/settings/integrations/mappings');
  return { ok: true, id: data.id as string };
}

const replaySchema = z.object({ eventId: z.string().uuid(), reason: z.string().min(3).max(300) });

/** Request a replay of a failed/dead-lettered event (replay permission). */
export async function requestEventReplay(
  input: z.infer<typeof replaySchema>,
): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  const hasPermission = ensurePermission(ctx, 'integrations.events.replay');
  const parsed = replaySchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a reason (min 3 chars).' };

  const res = await requestReplay({
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    hasPermission,
    eventId: parsed.data.eventId,
    reason: parsed.data.reason,
  });
  if (!res.ok) return { error: res.reason };
  revalidatePath('/settings/integrations/replay');
  revalidatePath('/integrations/events');
  return { ok: true, id: res.replayId };
}
