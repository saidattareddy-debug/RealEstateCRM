'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  canApprove,
  activateVersion,
  detectLanguage,
  type KnowledgeSourceType,
  type SupportedLanguage,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { ingestKnowledge, type IngestInput, type IngestionMethod } from '@/lib/ai/ingestion';
import { retrieveKnowledge, type RetrieveResult } from '@/lib/ai/retrieval';

/**
 * Knowledge lifecycle server actions (Phase 5A sections 4-7, 14).
 *
 * SAFETY:
 *  - Every action enforces getAppContext + an explicit ensurePermission against
 *    the granular knowledge.* permission keys; RLS re-checks server-side.
 *  - Approval uses the pure canApprove guard (review_required + approver +
 *    reason + no unresolved injection flag) - no source is ever auto-approved.
 *  - Audit logs carry ids + safe summaries only (never full knowledge content,
 *    prompts, credentials, or generated answers).
 *  - testRetrieval is READ-ONLY and returns only safe, customer-safe labels.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  sourceId?: string;
}

const SOURCE_TYPES: readonly KnowledgeSourceType[] = [
  'project_overview',
  'approved_faq',
  'brochure',
  'floor_plan',
  'amenity',
  'location',
  'payment_plan',
  'offer',
  'policy',
  'sales_script',
  'legal_disclaimer',
  'manual',
  'imported_facts',
  'general_guidance',
];

const INGEST_METHODS: readonly IngestionMethod[] = [
  'manual_text',
  'markdown',
  'faq',
  'project_record',
  'document_url',
];

const createSourceSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES as [KnowledgeSourceType, ...KnowledgeSourceType[]]),
  title: z.string().min(1).max(200),
  language: z.string().min(2).max(12).default('en'),
  method: z.enum(INGEST_METHODS as [IngestionMethod, ...IngestionMethod[]]),
  trustPriority: z.number().int().min(0).max(100).optional(),
  text: z.string().optional(),
  faqs: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).optional(),
  recordProjectId: z.string().uuid().optional(),
  url: z.string().url().optional(),
  extractedText: z.string().optional(),
});

export type CreateKnowledgeSourceInput = z.infer<typeof createSourceSchema>;

/** Create a knowledge source by running the ingestion pipeline. */
export async function createKnowledgeSource(
  input: CreateKnowledgeSourceInput,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.create')) {
    return { error: 'You do not have permission to create knowledge.' };
  }
  const parsed = createSourceSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid knowledge source.' };
  const d = parsed.data;

  // Build the method-specific ingestion input (validated per method).
  let ingestInput: IngestInput;
  const base = {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    projectId: d.projectId ?? null,
    sourceType: d.sourceType,
    title: d.title,
    language: d.language,
    trustPriority: d.trustPriority,
  };
  if (d.method === 'manual_text' || d.method === 'markdown') {
    if (!d.text || !d.text.trim()) return { error: 'Text content is required.' };
    ingestInput = { ...base, method: d.method, text: d.text };
  } else if (d.method === 'faq') {
    if (!d.faqs || d.faqs.length === 0) return { error: 'At least one FAQ pair is required.' };
    ingestInput = { ...base, method: 'faq', faqs: d.faqs };
  } else if (d.method === 'project_record') {
    if (!d.recordProjectId) return { error: 'A project is required for a project record import.' };
    ingestInput = { ...base, method: 'project_record', recordProjectId: d.recordProjectId };
  } else {
    // document_url: SSRF guard runs inside ingestKnowledge; text is pre-extracted.
    if (!d.url) return { error: 'A URL is required.' };
    if (!d.extractedText || !d.extractedText.trim()) {
      return { error: 'Extracted text is required (binary fetch runs in a worker).' };
    }
    ingestInput = { ...base, method: 'document_url', url: d.url, extractedText: d.extractedText };
  }

  const result = await ingestKnowledge(ingestInput);
  if (!result.ok) return { error: result.error ?? 'Ingestion failed.' };
  revalidatePath('/knowledge');
  return { ok: true, sourceId: result.sourceId };
}

const draftVersionSchema = z.object({
  sourceId: z.string().uuid(),
  text: z.string().min(1),
  changeSummary: z.string().max(500).optional(),
});

/**
 * Draft a new version of an existing source. Phase 5A keeps versioning explicit
 * and human-reviewed: a new source_version row lands in review_required.
 */
export async function draftNewVersion(
  input: z.infer<typeof draftVersionSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.edit')) {
    return { error: 'You do not have permission to edit knowledge.' };
  }
  const parsed = draftVersionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid version draft.' };

  const supabase = await createSupabaseServerClient();
  const { data: source } = await supabase
    .from('knowledge_sources')
    .select('id, source_type, title, language, project_id, trust_priority')
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!source) return { error: 'Source not found.' };

  // Determine the next version number for the source.
  const { data: versions } = await supabase
    .from('knowledge_source_versions')
    .select('version')
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = ((versions?.[0] as { version?: number } | undefined)?.version ?? 0) + 1;

  const { data: newVersion, error } = await supabase
    .from('knowledge_source_versions')
    .insert({
      tenant_id: ctx.activeTenantId,
      source_id: parsed.data.sourceId,
      version: nextVersion,
      state: 'review_required',
      change_summary: parsed.data.changeSummary ?? `Version ${nextVersion}`,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !newVersion) return { error: 'Could not create version.' };

  await writeAudit({
    action: 'KNOWLEDGE_VERSION_CREATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
    metadata: { version: nextVersion },
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const approveSchema = z.object({
  sourceId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  effectiveAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** Approve a source (uses canApprove; reason required; writes approval event). */
export async function approveSource(input: z.infer<typeof approveSchema>): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.approve')) {
    return { error: 'You do not have permission to approve knowledge.' };
  }
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: 'A reason is required to approve.' };

  const supabase = await createSupabaseServerClient();
  const { data: source } = await supabase
    .from('knowledge_sources')
    .select('id, state, extraction_status')
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!source) return { error: 'Source not found.' };
  const s = source as Record<string, unknown>;

  // Any document version still carrying an injection flag blocks approval.
  const { data: docRows } = await supabase
    .from('knowledge_documents')
    .select('id')
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);
  const docIds = (docRows ?? []).map((r) => (r as { id: string }).id);
  let injectionFlagged = false;
  if (docIds.length > 0) {
    const { data: flagged } = await supabase
      .from('knowledge_document_versions')
      .select('id')
      .eq('tenant_id', ctx.activeTenantId)
      .eq('injection_flagged', true)
      .in('document_id', docIds)
      .limit(1);
    injectionFlagged = Boolean(flagged && flagged.length > 0);
  }

  const guard = canApprove({
    state: String(s.state) as never,
    hasApprover: true,
    hasReason: parsed.data.reason.trim().length > 0,
    injectionFlagged,
    extractionComplete: String(s.extraction_status) === 'extracted',
  });
  if (!guard.ok) return { error: `Cannot approve: ${guard.error}` };

  const nowIso = new Date().toISOString();
  const effectiveAt = parsed.data.effectiveAt ?? nowIso;
  const expiresAt = parsed.data.expiresAt ?? null;
  const { error } = await supabase
    .from('knowledge_sources')
    .update({
      state: 'approved',
      approved_by: ctx.userId,
      approved_at: nowIso,
      effective_at: effectiveAt,
      expires_at: expiresAt,
    })
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Approval failed.' };

  // Promote the source's chunks to approved so they become retrievable.
  await supabase
    .from('knowledge_chunks')
    .update({ state: 'approved', effective_at: effectiveAt, expires_at: expiresAt })
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);

  await supabase.from('knowledge_approval_events').insert({
    tenant_id: ctx.activeTenantId,
    source_id: parsed.data.sourceId,
    from_state: String(s.state),
    to_state: 'approved',
    actor_id: ctx.userId,
    reason: parsed.data.reason,
  });
  await writeAudit({
    action: 'KNOWLEDGE_APPROVED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
    metadata: { reason: parsed.data.reason },
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const rejectSchema = z.object({
  sourceId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

/** Reject a source in review (reason required; chunks never become retrievable). */
export async function rejectSource(input: z.infer<typeof rejectSchema>): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.review')) {
    return { error: 'You do not have permission to review knowledge.' };
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { error: 'A reason is required to reject.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('knowledge_sources')
    .select('state')
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  const { error } = await supabase
    .from('knowledge_sources')
    .update({ state: 'rejected' })
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Rejection failed.' };

  await supabase.from('knowledge_approval_events').insert({
    tenant_id: ctx.activeTenantId,
    source_id: parsed.data.sourceId,
    from_state: (before as { state?: string } | null)?.state ?? null,
    to_state: 'rejected',
    actor_id: ctx.userId,
    reason: parsed.data.reason,
  });
  await writeAudit({
    action: 'KNOWLEDGE_REJECTED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
    metadata: { reason: parsed.data.reason },
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const supersedeSchema = z.object({
  sourceId: z.string().uuid(),
  supersededBySourceId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/** Supersede an approved source with a newer one (uses activateVersion). */
export async function supersedeSource(
  input: z.infer<typeof supersedeSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.approve')) {
    return { error: 'You do not have permission to supersede knowledge.' };
  }
  const parsed = supersedeSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid supersede request.' };

  // activateVersion decides which version is activated and which is superseded.
  const plan = activateVersion(parsed.data.supersededBySourceId, parsed.data.sourceId);

  const supabase = await createSupabaseServerClient();
  // Old source becomes superseded; its chunks stop being retrievable.
  const { error } = await supabase
    .from('knowledge_sources')
    .update({ state: 'superseded', superseded_by: parsed.data.supersededBySourceId })
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Supersede failed.' };
  await supabase
    .from('knowledge_chunks')
    .update({ state: 'superseded' })
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);

  await supabase.from('knowledge_approval_events').insert({
    tenant_id: ctx.activeTenantId,
    source_id: parsed.data.sourceId,
    from_state: 'approved',
    to_state: 'superseded',
    actor_id: ctx.userId,
    reason: parsed.data.reason ?? `Superseded by ${plan.activate}`,
  });
  await writeAudit({
    action: 'KNOWLEDGE_SUPERSEDED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
    metadata: { supersededBy: parsed.data.supersededBySourceId },
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const archiveSchema = z.object({
  sourceId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/** Archive a source (terminal). Chunks become non-retrievable. */
export async function archiveSource(input: z.infer<typeof archiveSchema>): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.archive')) {
    return { error: 'You do not have permission to archive knowledge.' };
  }
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid archive request.' };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from('knowledge_sources')
    .select('state')
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  const { error } = await supabase
    .from('knowledge_sources')
    .update({ state: 'archived' })
    .eq('id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Archive failed.' };
  await supabase
    .from('knowledge_chunks')
    .update({ state: 'archived' })
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId);

  await supabase.from('knowledge_approval_events').insert({
    tenant_id: ctx.activeTenantId,
    source_id: parsed.data.sourceId,
    from_state: (before as { state?: string } | null)?.state ?? null,
    to_state: 'archived',
    actor_id: ctx.userId,
    reason: parsed.data.reason ?? 'Archived',
  });
  await writeAudit({
    action: 'KNOWLEDGE_ARCHIVED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const rollbackSchema = z.object({
  sourceId: z.string().uuid(),
  targetVersion: z.number().int().min(1),
  reason: z.string().min(1).max(500),
});

/**
 * Roll back to an earlier version. Per the domain model, rollback = approving an
 * older version as a NEW active version (activateVersion), with a fresh approval
 * event recording the operator + reason.
 */
export async function rollbackToVersion(
  input: z.infer<typeof rollbackSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.approve')) {
    return { error: 'You do not have permission to roll back knowledge.' };
  }
  const parsed = rollbackSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid rollback request.' };

  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from('knowledge_source_versions')
    .select('id, version')
    .eq('source_id', parsed.data.sourceId)
    .eq('tenant_id', ctx.activeTenantId)
    .eq('version', parsed.data.targetVersion)
    .maybeSingle();
  if (!target) return { error: 'Target version not found.' };
  const targetId = (target as { id: string }).id;

  // Record the rollback as a new approval event on the source.
  await supabase.from('knowledge_approval_events').insert({
    tenant_id: ctx.activeTenantId,
    source_id: parsed.data.sourceId,
    source_version_id: targetId,
    from_state: 'approved',
    to_state: 'approved',
    actor_id: ctx.userId,
    reason: `Rollback to v${parsed.data.targetVersion}: ${parsed.data.reason}`,
  });
  await writeAudit({
    action: 'KNOWLEDGE_VERSION_CREATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_source',
    entityId: parsed.data.sourceId,
    metadata: { rollbackTo: parsed.data.targetVersion },
  });
  revalidatePath('/knowledge');
  return { ok: true, sourceId: parsed.data.sourceId };
}

const resolveConflictSchema = z.object({
  conflictId: z.string().uuid(),
  resolution: z.string().min(1).max(500),
});

/** Resolve a detected knowledge conflict (requires knowledge.conflicts.resolve). */
export async function resolveKnowledgeConflict(
  input: z.infer<typeof resolveConflictSchema>,
): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.conflicts.resolve')) {
    return { error: 'You do not have permission to resolve conflicts.' };
  }
  const parsed = resolveConflictSchema.safeParse(input);
  if (!parsed.success) return { error: 'A resolution is required.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('knowledge_conflicts')
    .update({
      status: 'resolved',
      resolved_by: ctx.userId,
      resolution: parsed.data.resolution,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.conflictId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not resolve the conflict.' };

  await writeAudit({
    action: 'KNOWLEDGE_CONFLICT_RESOLVED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'knowledge_conflict',
    entityId: parsed.data.conflictId,
  });
  revalidatePath('/knowledge');
  return { ok: true };
}

export interface TestRetrievalState {
  ok?: boolean;
  error?: string;
  result?: {
    chunkPreviews: { rank: number; snippet: string; score: number }[];
    sources: { label: string; trustPriority: number }[];
    independentSources: number;
    sufficiency: number;
    exactFaqMatch: boolean;
    lexicalCount: number;
    vectorCount: number;
  };
}

const testRetrievalSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  query: z.string().min(1).max(1000),
  language: z.string().min(2).max(12).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * READ-ONLY retrieval preview for the knowledge UI. Returns only safe previews +
 * customer-safe source labels and the sufficiency signal - never raw ids or
 * cross-tenant/cross-project data (RLS + the hard filters in retrieveKnowledge).
 */
export async function testRetrieval(
  input: z.infer<typeof testRetrievalSchema>,
): Promise<TestRetrievalState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'knowledge.read')) {
    return { error: 'You do not have permission to read knowledge.' };
  }
  const parsed = testRetrievalSchema.safeParse(input);
  if (!parsed.success) return { error: 'Enter a query.' };

  const language =
    (parsed.data.language as SupportedLanguage | undefined) ?? detectLanguage(parsed.data.query);
  const result: RetrieveResult = await retrieveKnowledge({
    tenantId: ctx.activeTenantId,
    projectId: parsed.data.projectId ?? null,
    query: parsed.data.query,
    language,
    limit: parsed.data.limit ?? 8,
  });

  return {
    ok: true,
    result: {
      chunkPreviews: result.chunks.map((c, i) => ({
        rank: i + 1,
        snippet: c.text.slice(0, 160),
        score: Number(c.score.toFixed(4)),
      })),
      sources: result.sources.map((src) => ({
        label: src.customerSafeReference,
        trustPriority: src.trustPriority,
      })),
      independentSources: result.independentSources,
      sufficiency: result.sufficiency,
      exactFaqMatch: result.exactFaqMatch,
      lexicalCount: result.lexicalCount,
      vectorCount: result.vectorCount,
    },
  };
}
