'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parsePortalEmail, stripQuotedHistory, type IntegrationProvider } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

type ActionResult = { ok?: boolean; error?: string; id?: string };

async function authRules() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.email.rules.manage')) {
    return { error: 'You do not have permission to manage email rules.' as const };
  }
  return { ctx, tenantId: ctx.activeTenantId };
}

const ruleSchema = z.object({
  connectionId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  adapter: z.string().min(1).max(60),
  config: z.record(z.unknown()).default({}),
});

/** Create an email parsing rule. */
export async function createParserRule(input: z.infer<typeof ruleSchema>): Promise<ActionResult> {
  const auth = await authRules();
  if ('error' in auth) return { error: auth.error };
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { error: 'Provide a name and adapter.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('email_parsing_rules')
    .insert({
      tenant_id: tenantId,
      connection_id: parsed.data.connectionId ?? null,
      name: parsed.data.name,
      adapter: parsed.data.adapter,
      config: parsed.data.config,
      version: 1,
      active: true,
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create rule.' };

  await writeAudit({
    action: 'EMAIL_PARSER_RULE_CREATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'email_parsing_rule',
    entityId: data.id as string,
    metadata: { name: parsed.data.name, adapter: parsed.data.adapter },
  });
  revalidatePath('/settings/integrations/email');
  return { ok: true, id: data.id as string };
}

const toggleSchema = z.object({ ruleId: z.string().uuid(), active: z.boolean() });

/** Enable/disable an email parsing rule. */
export async function setParserRuleActive(
  input: z.infer<typeof toggleSchema>,
): Promise<ActionResult> {
  const auth = await authRules();
  if ('error' in auth) return { error: auth.error };
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid input.' };
  const { tenantId, ctx } = auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('email_parsing_rules')
    .update({ active: parsed.data.active })
    .eq('tenant_id', tenantId)
    .eq('id', parsed.data.ruleId);
  if (error) return { error: error.message };
  await writeAudit({
    action: 'EMAIL_PARSER_RULE_UPDATED',
    tenantId,
    actorUserId: ctx.userId,
    entityType: 'email_parsing_rule',
    entityId: parsed.data.ruleId,
    metadata: { active: parsed.data.active },
  });
  revalidatePath('/settings/integrations/email');
  return { ok: true };
}

const testSchema = z.object({
  provider: z.string().min(1),
  body: z.string().min(1).max(8000),
});

export interface EmailTestResult {
  ok: boolean;
  error?: string;
  review?: boolean;
  confidence?: string;
  parserVersion?: string;
  fields?: Record<string, string | undefined>;
  missingRequired?: string[];
  cleanedBody?: string;
}

/**
 * Run a SYNTHETIC email through the deterministic portal parser and return a
 * parsing-result preview. No mailbox is connected and no message is ingested.
 */
export async function runSyntheticEmailTest(
  input: z.infer<typeof testSchema>,
): Promise<EmailTestResult> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'channels.email.test')) {
    return { ok: false, error: 'You do not have permission to run email tests.' };
  }
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Provide synthetic email text.' };

  const cleaned = stripQuotedHistory(parsed.data.body);
  const result = parsePortalEmail(parsed.data.provider as IntegrationProvider, cleaned);
  return {
    ok: true,
    review: result.review,
    confidence: result.confidence,
    parserVersion: result.parserVersion,
    fields: result.fields,
    missingRequired: result.missingRequired,
    cleanedBody: cleaned,
  };
}
