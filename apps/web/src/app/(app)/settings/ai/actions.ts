'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * AI Settings server actions (Phase 5A). Each action:
 *  - enforces getAppContext + an explicit ensurePermission against a granular
 *    `ai.*` permission key; RLS re-checks server-side.
 *  - validates input with zod at the boundary.
 *  - writes an audit log carrying reference ids + safe summaries ONLY — never a
 *    provider secret, raw prompt body, model temperature is fine, etc.
 *  - revalidates the affected page.
 *
 * SAFETY (provider secrets): we only ever accept and store `secret_ref`, the
 * NAME of a server-side environment variable. We NEVER accept, store, return or
 * log a raw secret value. External providers stay `available = false` until a
 * matching server credential is wired in deployment configuration — this UI
 * never fakes a successful connection.
 *
 * SAFETY (operating level): `automatic` may be stored as a policy value, but
 * automatic answering is NOT enabled in Phase 5A and is denied at runtime
 * (packages/domain ai-guard). No action here ever sends a customer message.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

// An env-var NAME, never a secret value: letters/digits/underscore only.
const secretRefSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use an UPPER_SNAKE_CASE env var name (no secret value).')
  .max(128);

// ---------------------------------------------------------------------------
// Providers (ai.providers.manage)
// ---------------------------------------------------------------------------

const upsertProviderSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['chat', 'embedding']),
  adapter: z.enum(['mock', 'external']),
  displayName: z.string().trim().min(1).max(120),
  // Only the env-var NAME is ever accepted. Empty => no credential reference.
  secretRef: secretRefSchema.optional().nullable(),
  baseUrl: z.string().url().max(2048).optional().nullable(),
});

export type UpsertProviderInput = z.infer<typeof upsertProviderSchema>;

/**
 * Create or update a provider config. `available` is derived honestly:
 *  - mock adapters are always available (deterministic, no credential needed);
 *  - external adapters are available ONLY when a secret_ref (env var name) is
 *    present AND that env var is actually set on the server. We never trust the
 *    client and never fake availability.
 */
export async function upsertProviderConfig(input: UpsertProviderInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.providers.manage')) {
    return { error: 'You do not have permission to manage AI providers.' };
  }
  const parsed = upsertProviderSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid provider configuration.' };
  const d = parsed.data;

  const secretRef = d.secretRef && d.secretRef.length > 0 ? d.secretRef : null;
  if (d.adapter === 'external' && !secretRef) {
    return { error: 'External providers require a server env-var name (secret reference).' };
  }
  // Availability is honest: only true when a credential genuinely exists.
  const credentialPresent =
    secretRef != null &&
    typeof process.env[secretRef] === 'string' &&
    process.env[secretRef] !== '';
  const available = d.adapter === 'mock' ? true : credentialPresent;

  const supabase = await createSupabaseServerClient();
  const row = {
    tenant_id: ctx.activeTenantId,
    kind: d.kind,
    adapter: d.adapter,
    display_name: d.displayName,
    secret_ref: secretRef, // env var NAME only — never the secret value
    base_url: d.baseUrl && d.baseUrl.length > 0 ? d.baseUrl : null,
    available,
  };

  let id = d.id;
  if (id) {
    const { error } = await supabase
      .from('ai_provider_configs')
      .update(row)
      .eq('id', id)
      .eq('tenant_id', ctx.activeTenantId);
    if (error) return { error: 'Could not update the provider.' };
  } else {
    const { data, error } = await supabase
      .from('ai_provider_configs')
      .insert(row)
      .select('id')
      .single();
    if (error || !data) return { error: 'Could not create the provider.' };
    id = (data as { id: string }).id;
  }

  await writeAudit({
    action: 'AI_PROVIDER_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_provider_config',
    entityId: id ?? null,
    // Safe summary only: never the secret value. secret_ref is just an env name.
    newValues: { kind: d.kind, adapter: d.adapter, available, secretRefPresent: secretRef != null },
  });
  revalidatePath('/settings/ai/providers');
  revalidatePath('/settings/ai');
  return { ok: true, id };
}

const setProviderActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export async function setProviderActive(
  input: z.infer<typeof setProviderActiveSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.providers.manage')) {
    return { error: 'You do not have permission to manage AI providers.' };
  }
  const parsed = setProviderActiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('ai_provider_configs')
    .update({ active: parsed.data.active })
    .eq('id', parsed.data.id)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not update the provider.' };

  await writeAudit({
    action: 'AI_PROVIDER_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_provider_config',
    entityId: parsed.data.id,
    newValues: { active: parsed.data.active },
  });
  revalidatePath('/settings/ai/providers');
  revalidatePath('/settings/ai');
  return { ok: true, id: parsed.data.id };
}

// ---------------------------------------------------------------------------
// Models (ai.providers.manage)
// ---------------------------------------------------------------------------

const upsertModelSchema = z.object({
  id: z.string().uuid().optional(),
  providerConfigId: z.string().uuid(),
  modelName: z.string().trim().min(1).max(160),
  maxInputTokens: z.coerce.number().int().min(1).max(2_000_000),
  maxOutputTokens: z.coerce.number().int().min(1).max(2_000_000),
  temperature: z.coerce.number().min(0).max(2),
  active: z.boolean().optional(),
});

export type UpsertModelInput = z.infer<typeof upsertModelSchema>;

export async function upsertModelConfig(input: UpsertModelInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.providers.manage')) {
    return { error: 'You do not have permission to manage AI models.' };
  }
  const parsed = upsertModelSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid model configuration.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  // Confirm the provider belongs to this tenant and is a chat provider (RLS also enforces tenant).
  const { data: provider } = await supabase
    .from('ai_provider_configs')
    .select('id, kind')
    .eq('id', d.providerConfigId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!provider) return { error: 'Provider not found.' };
  if ((provider as { kind: string }).kind !== 'chat') {
    return { error: 'Chat models must reference a chat provider.' };
  }

  const row = {
    tenant_id: ctx.activeTenantId,
    provider_config_id: d.providerConfigId,
    model_name: d.modelName,
    max_input_tokens: d.maxInputTokens,
    max_output_tokens: d.maxOutputTokens,
    temperature: d.temperature,
    active: d.active ?? true,
  };

  let id = d.id;
  if (id) {
    const { error } = await supabase
      .from('ai_model_configs')
      .update(row)
      .eq('id', id)
      .eq('tenant_id', ctx.activeTenantId);
    if (error) return { error: 'Could not update the model.' };
  } else {
    const { data, error } = await supabase
      .from('ai_model_configs')
      .insert(row)
      .select('id')
      .single();
    if (error || !data) return { error: 'Could not create the model (duplicate model name?).' };
    id = (data as { id: string }).id;
  }

  await writeAudit({
    action: 'AI_MODEL_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_model_config',
    entityId: id ?? null,
    newValues: { modelName: d.modelName, active: row.active },
  });
  revalidatePath('/settings/ai/models');
  revalidatePath('/settings/ai');
  return { ok: true, id };
}

const upsertEmbeddingModelSchema = z.object({
  id: z.string().uuid().optional(),
  providerConfigId: z.string().uuid(),
  modelName: z.string().trim().min(1).max(160),
  dimensions: z.coerce.number().int().min(1).max(8192),
  active: z.boolean().optional(),
});

export type UpsertEmbeddingModelInput = z.infer<typeof upsertEmbeddingModelSchema>;

export async function upsertEmbeddingModelConfig(
  input: UpsertEmbeddingModelInput,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.providers.manage')) {
    return { error: 'You do not have permission to manage embedding models.' };
  }
  const parsed = upsertEmbeddingModelSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid embedding model configuration.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: provider } = await supabase
    .from('ai_provider_configs')
    .select('id, kind')
    .eq('id', d.providerConfigId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!provider) return { error: 'Provider not found.' };
  if ((provider as { kind: string }).kind !== 'embedding') {
    return { error: 'Embedding models must reference an embedding provider.' };
  }

  const row = {
    tenant_id: ctx.activeTenantId,
    provider_config_id: d.providerConfigId,
    model_name: d.modelName,
    dimensions: d.dimensions,
    active: d.active ?? true,
  };

  let id = d.id;
  if (id) {
    const { error } = await supabase
      .from('embedding_model_configs')
      .update(row)
      .eq('id', id)
      .eq('tenant_id', ctx.activeTenantId);
    if (error) return { error: 'Could not update the embedding model.' };
  } else {
    const { data, error } = await supabase
      .from('embedding_model_configs')
      .insert(row)
      .select('id')
      .single();
    if (error || !data) {
      return { error: 'Could not create the embedding model (duplicate model name?).' };
    }
    id = (data as { id: string }).id;
  }

  await writeAudit({
    action: 'AI_MODEL_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'embedding_model_config',
    entityId: id ?? null,
    newValues: { modelName: d.modelName, dimensions: d.dimensions, active: row.active },
  });
  revalidatePath('/settings/ai/models');
  revalidatePath('/settings/ai');
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Feature policies (ai.settings.manage) — tenant default or per-project
// ---------------------------------------------------------------------------

const upsertPolicySchema = z.object({
  // null project_id => the tenant-wide default policy.
  projectId: z.string().uuid().nullable().optional(),
  operatingLevel: z.enum(['disabled', 'shadow', 'copilot', 'automatic']),
  generalAnswersEnabled: z.boolean(),
  englishFallbackAllowed: z.boolean(),
  shadowSampleRate: z.coerce.number().min(0).max(1),
  copilotEnabled: z.boolean(),
  languagePolicy: z.record(z.unknown()).optional(),
  escalationPolicy: z.record(z.unknown()).optional(),
});

export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

export async function upsertFeaturePolicy(input: UpsertPolicyInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.settings.manage')) {
    return { error: 'You do not have permission to manage AI policies.' };
  }
  const parsed = upsertPolicySchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid AI policy.' };
  const d = parsed.data;
  const projectId = d.projectId ?? null;

  const supabase = await createSupabaseServerClient();
  if (projectId) {
    // Confirm the project belongs to this tenant under RLS.
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return { error: 'Project not found.' };
  }

  const row = {
    tenant_id: ctx.activeTenantId,
    project_id: projectId,
    operating_level: d.operatingLevel,
    general_answers_enabled: d.generalAnswersEnabled,
    english_fallback_allowed: d.englishFallbackAllowed,
    shadow_sample_rate: d.shadowSampleRate,
    copilot_enabled: d.copilotEnabled,
    language_policy: d.languagePolicy ?? {},
    escalation_policy: d.escalationPolicy ?? {},
  };

  // Upsert on the (tenant_id, project_id) unique key. A null project_id is the
  // tenant default; onConflict handles both branches.
  const { data, error } = await supabase
    .from('ai_feature_policies')
    .upsert(row, { onConflict: 'tenant_id,project_id' })
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not save the policy.' };
  const id = (data as { id: string }).id;

  await writeAudit({
    action: 'AI_POLICY_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_feature_policy',
    entityId: id,
    newValues: {
      projectScoped: projectId != null,
      operatingLevel: d.operatingLevel,
      generalAnswersEnabled: d.generalAnswersEnabled,
      copilotEnabled: d.copilotEnabled,
    },
  });
  revalidatePath('/settings/ai/policies');
  revalidatePath('/settings/ai');
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Usage limits (ai.settings.manage)
// ---------------------------------------------------------------------------

const updateUsageSchema = z.object({
  dailyTokenLimit: z.coerce.number().int().min(0),
  monthlyTokenLimit: z.coerce.number().int().min(0),
  perConversationTokenLimit: z.coerce.number().int().min(0),
  perRequestInputLimit: z.coerce.number().int().min(0),
  perRequestOutputLimit: z.coerce.number().int().min(0),
  retrievalResultLimit: z.coerce.number().int().min(0),
  toolCallLimit: z.coerce.number().int().min(0),
  maxRetries: z.coerce.number().int().min(0),
});

export type UpdateUsageInput = z.infer<typeof updateUsageSchema>;

export async function updateUsageLimits(input: UpdateUsageInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.settings.manage')) {
    return { error: 'You do not have permission to manage AI usage limits.' };
  }
  const parsed = updateUsageSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid usage limits.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  // One row per tenant; upsert on the tenant_id unique key.
  const { data, error } = await supabase
    .from('ai_usage_limits')
    .upsert(
      {
        tenant_id: ctx.activeTenantId,
        daily_token_limit: d.dailyTokenLimit,
        monthly_token_limit: d.monthlyTokenLimit,
        per_conversation_token_limit: d.perConversationTokenLimit,
        per_request_input_limit: d.perRequestInputLimit,
        per_request_output_limit: d.perRequestOutputLimit,
        retrieval_result_limit: d.retrievalResultLimit,
        tool_call_limit: d.toolCallLimit,
        max_retries: d.maxRetries,
      },
      { onConflict: 'tenant_id' },
    )
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not save the usage limits.' };

  await writeAudit({
    action: 'AI_POLICY_UPDATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_usage_limits',
    entityId: (data as { id: string }).id,
    newValues: {
      dailyTokenLimit: d.dailyTokenLimit,
      monthlyTokenLimit: d.monthlyTokenLimit,
      perConversationTokenLimit: d.perConversationTokenLimit,
    },
  });
  revalidatePath('/settings/ai/usage');
  revalidatePath('/settings/ai');
  return { ok: true, id: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Prompts + versions (ai.prompts.manage)
// ---------------------------------------------------------------------------

const createPromptSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_.-]*$/, 'Use a lowercase key (letters, digits, . _ -).'),
  description: z.string().trim().max(500).optional().nullable(),
});

export type CreatePromptInput = z.infer<typeof createPromptSchema>;

export async function createPrompt(input: CreatePromptInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.prompts.manage')) {
    return { error: 'You do not have permission to manage AI prompts.' };
  }
  const parsed = createPromptSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid prompt key.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_prompts')
    .insert({
      tenant_id: ctx.activeTenantId,
      key: d.key,
      description: d.description && d.description.length > 0 ? d.description : null,
    })
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not create the prompt (duplicate key?).' };
  const id = (data as { id: string }).id;

  await writeAudit({
    action: 'AI_PROMPT_VERSION_CREATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_prompt',
    entityId: id,
    // Reference only — never the prompt body.
    newValues: { key: d.key },
  });
  revalidatePath('/settings/ai/prompts');
  return { ok: true, id };
}

const createPromptVersionSchema = z.object({
  promptId: z.string().uuid(),
  body: z.string().min(1).max(50_000),
  changeSummary: z.string().trim().max(500).optional().nullable(),
});

export type CreatePromptVersionInput = z.infer<typeof createPromptVersionSchema>;

/**
 * Draft a new prompt version. New versions land INACTIVE — a separate, explicit
 * activate step makes a version live (so nothing goes live by accident).
 */
export async function createPromptVersion(input: CreatePromptVersionInput): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.prompts.manage')) {
    return { error: 'You do not have permission to manage AI prompts.' };
  }
  const parsed = createPromptVersionSchema.safeParse(input);
  if (!parsed.success) return { error: 'A prompt body is required.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: prompt } = await supabase
    .from('ai_prompts')
    .select('id')
    .eq('id', d.promptId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!prompt) return { error: 'Prompt not found.' };

  const { data: versions } = await supabase
    .from('ai_prompt_versions')
    .select('version')
    .eq('prompt_id', d.promptId)
    .eq('tenant_id', ctx.activeTenantId)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = ((versions?.[0] as { version?: number } | undefined)?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from('ai_prompt_versions')
    .insert({
      tenant_id: ctx.activeTenantId,
      prompt_id: d.promptId,
      version: nextVersion,
      body: d.body,
      change_summary: d.changeSummary && d.changeSummary.length > 0 ? d.changeSummary : null,
      active: false, // explicit activation required
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not create the version.' };
  const id = (data as { id: string }).id;

  await writeAudit({
    action: 'AI_PROMPT_VERSION_CREATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_prompt_version',
    entityId: id,
    // Reference + version only — never the prompt body.
    metadata: { promptId: d.promptId, version: nextVersion },
  });
  revalidatePath('/settings/ai/prompts');
  return { ok: true, id };
}

const activatePromptVersionSchema = z.object({
  promptId: z.string().uuid(),
  versionId: z.string().uuid(),
});

/** Activate one version (deactivating the others for the same prompt). */
export async function activatePromptVersion(
  input: z.infer<typeof activatePromptVersionSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.prompts.manage')) {
    return { error: 'You do not have permission to manage AI prompts.' };
  }
  const parsed = activatePromptVersionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid request.' };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  // Confirm the version belongs to the prompt + tenant.
  const { data: version } = await supabase
    .from('ai_prompt_versions')
    .select('id, version')
    .eq('id', d.versionId)
    .eq('prompt_id', d.promptId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!version) return { error: 'Version not found.' };

  // Deactivate every version of this prompt, then activate the chosen one.
  const { error: deErr } = await supabase
    .from('ai_prompt_versions')
    .update({ active: false })
    .eq('prompt_id', d.promptId)
    .eq('tenant_id', ctx.activeTenantId);
  if (deErr) return { error: 'Could not update versions.' };

  const { error: actErr } = await supabase
    .from('ai_prompt_versions')
    .update({ active: true })
    .eq('id', d.versionId)
    .eq('tenant_id', ctx.activeTenantId);
  if (actErr) return { error: 'Could not activate the version.' };

  await writeAudit({
    action: 'AI_PROMPT_ACTIVATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_prompt_version',
    entityId: d.versionId,
    metadata: { promptId: d.promptId, version: (version as { version: number }).version },
  });
  revalidatePath('/settings/ai/prompts');
  return { ok: true, id: d.versionId };
}
