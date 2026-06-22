'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { simulateHumanSend } from '@/lib/integrations/human-send';

type ActionResult = { ok?: boolean; error?: string; id?: string };

async function authTemplates() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.whatsapp.templates.manage')) {
    return { error: 'You do not have permission to manage WhatsApp templates.' as const };
  }
  return { ctx, tenantId: ctx.activeTenantId };
}

const importSchema = z.object({
  connectionId: z.string().uuid(),
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(10).default('en'),
  category: z.string().max(40).default('utility'),
  bodyText: z.string().min(1).max(1024),
  variables: z.array(z.string()).default([]),
});

/**
 * Import a TEMPLATE FIXTURE (Phase 7A — no Meta call). Creates a local template +
 * first version from a synthetic fixture. Status is `approved` (fixture) so the
 * simulation can exercise template paths; nothing is submitted to a provider.
 */
export async function importTemplateFixture(
  input: z.infer<typeof importSchema>,
): Promise<ActionResult> {
  const auth = await authTemplates();
  if ('error' in auth) return { error: auth.error };
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a name and body.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data: tmpl, error } = await supabase
    .from('whatsapp_message_templates')
    .insert({
      tenant_id: tenantId,
      connection_id: parsed.data.connectionId,
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category,
      status: 'approved',
      last_synced_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !tmpl) return { error: error?.message ?? 'Could not import template.' };

  const variableSchema: Record<string, string> = {};
  for (const v of parsed.data.variables) variableSchema[v] = 'string';
  await supabase.from('whatsapp_template_versions').insert({
    tenant_id: tenantId,
    template_id: tmpl.id as string,
    version: 1,
    components: [{ type: 'body', text: parsed.data.bodyText }],
    variable_schema: variableSchema,
    status: 'approved',
  });

  await writeAudit({
    action: 'WHATSAPP_TEMPLATE_IMPORTED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'whatsapp_message_template',
    entityId: tmpl.id as string,
    metadata: { name: parsed.data.name, language: parsed.data.language, fixture: true },
  });
  revalidatePath(`/settings/integrations/whatsapp/${parsed.data.connectionId}/templates`);
  return { ok: true, id: tmpl.id as string };
}

const draftSchema = z.object({
  connectionId: z.string().uuid(),
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(10).default('en'),
  bodyText: z.string().min(1).max(1024),
});

/** Create a LOCAL draft template (status draft; never submitted). */
export async function createLocalTemplateDraft(
  input: z.infer<typeof draftSchema>,
): Promise<ActionResult> {
  const auth = await authTemplates();
  if ('error' in auth) return { error: auth.error };
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a name and body.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data: tmpl, error } = await supabase
    .from('whatsapp_message_templates')
    .insert({
      tenant_id: tenantId,
      connection_id: parsed.data.connectionId,
      name: parsed.data.name,
      language: parsed.data.language,
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !tmpl) return { error: error?.message ?? 'Could not create draft.' };
  await supabase.from('whatsapp_template_versions').insert({
    tenant_id: tenantId,
    template_id: tmpl.id as string,
    version: 1,
    components: [{ type: 'body', text: parsed.data.bodyText }],
    status: 'draft',
  });
  await writeAudit({
    action: 'WHATSAPP_TEMPLATE_IMPORTED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'whatsapp_message_template',
    entityId: tmpl.id as string,
    metadata: { name: parsed.data.name, draft: true },
  });
  revalidatePath(`/settings/integrations/whatsapp/${parsed.data.connectionId}/templates`);
  return { ok: true, id: tmpl.id as string };
}

/** Disable a template locally. */
export async function disableTemplate(templateId: string): Promise<ActionResult> {
  const auth = await authTemplates();
  if ('error' in auth) return { error: auth.error };
  if (!z.string().uuid().safeParse(templateId).success) return { error: 'Invalid template.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('whatsapp_message_templates')
    .update({ status: 'disabled', disabled_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', templateId);
  if (error) return { error: error.message };
  await writeAudit({
    action: 'WHATSAPP_TEMPLATE_STATUS_CHANGED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'whatsapp_message_template',
    entityId: templateId,
    metadata: { status: 'disabled' },
  });
  revalidatePath('/settings/integrations/whatsapp');
  return { ok: true };
}

const mockInboundSchema = z.object({
  connectionId: z.string().uuid(),
  text: z.string().min(1).max(1024),
});

/**
 * Record a MOCK inbound WhatsApp message as an external event (record-only). No
 * provider call; this exercises the normalization/persistence path only.
 */
export async function recordMockInbound(
  input: z.infer<typeof mockInboundSchema>,
): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.whatsapp.test')) {
    return { error: 'You do not have permission to run WhatsApp tests.' };
  }
  const parsed = mockInboundSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide message text.' };
  const tenantId = ctx.activeTenantId;
  const supabase = await createSupabaseServerClient();

  const fakeId = `mock-${Date.now()}`;
  const { error } = await supabase.from('external_events').insert({
    tenant_id: tenantId,
    provider: 'whatsapp_cloud',
    connection_id: parsed.data.connectionId,
    external_event_id: fakeId,
    event_type: 'inbound_message',
    payload_hash: fakeId,
    idempotency_key: `${parsed.data.connectionId}:${fakeId}`,
    normalized_payload: { type: 'text', text: parsed.data.text },
    status: 'processed',
  });
  if (error) return { error: error.message };
  revalidatePath(`/settings/integrations/whatsapp/${parsed.data.connectionId}/test`);
  return { ok: true };
}

/** Record a MOCK delivery callback as a WhatsApp provider event (record-only). */
export async function recordMockDelivery(input: {
  connectionId: string;
  kind: string;
}): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.whatsapp.test')) {
    return { error: 'You do not have permission to run WhatsApp tests.' };
  }
  if (!z.string().uuid().safeParse(input.connectionId).success)
    return { error: 'Invalid connection.' };
  const tenantId = ctx.activeTenantId;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('whatsapp_provider_events').insert({
    tenant_id: tenantId,
    kind: input.kind,
  });
  if (error) return { error: error.message };
  revalidatePath(`/settings/integrations/whatsapp/${input.connectionId}/test`);
  return { ok: true };
}

const humanSendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(2000),
  templateId: z.string().uuid().nullable().optional(),
});

/**
 * Human outbound SIMULATION. Returns a safe preview and records a simulation
 * (simulated=true). NEVER sends, NEVER produces a delivered state or provider ref.
 */
export async function simulateHumanWhatsApp(
  input: z.infer<typeof humanSendSchema>,
): Promise<ActionResult & { preview?: string; blocked?: boolean; reason?: string }> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.human_send.simulate')) {
    return { error: 'You do not have permission to simulate sends.' };
  }
  const parsed = humanSendSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a message body.' };

  const res = await simulateHumanSend({
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    conversationId: parsed.data.conversationId,
    channel: 'whatsapp_cloud',
    body: parsed.data.body,
    templateId: parsed.data.templateId ?? null,
    idempotencyKey: `${parsed.data.conversationId}:${ctx.userId}:${Date.now()}`,
  });
  return {
    ok: res.ok,
    blocked: res.blocked,
    reason: res.reason,
    preview: res.preview,
  };
}
