import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  chunkDocument,
  normalizeText,
  fnv1aHex,
  detectInjection,
  type KnowledgeSourceType,
} from '@re/domain';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { getEmbeddingProvider } from '@/lib/ai/providers';
import { validateExternalUrl } from '@/lib/ai/url-safety';

/**
 * Knowledge ingestion pipeline (Phase 5A §6, §7, §15).
 *
 * Synchronous local execution is used here for development; in PRODUCTION this
 * work must run in a durable PGMQ job worker (idempotent, retried, DLQ'd). The
 * `knowledge_ingestion_jobs/_attempts/_errors` tables are written exactly as the
 * worker would, so the move to a queue is mechanical. This is clearly marked
 * NON-PRODUCTION below.
 *
 * SAFETY:
 *  - Ingested content is UNTRUSTED. We run `detectInjection` and, on a hit,
 *    flag the document version + record the safe injection categories + raise a
 *    security event via `writeAudit`. Content is never executed as instructions.
 *  - Only extracted/normalised TEXT + metadata are stored — never temp file
 *    paths. Binary upload extraction is DISABLED (local/dev-only stub).
 *  - URL ingestion is SSRF-guarded by `validateExternalUrl`.
 *  - The new source lands in state `review_required` (never auto-approved).
 *  - No provider credential is ever logged or placed in audit metadata.
 */

export type IngestionMethod =
  | 'manual_text'
  | 'markdown'
  | 'faq'
  | 'project_record'
  | 'document_url';

export interface IngestBaseInput {
  tenantId: string;
  actorUserId: string;
  projectId: string | null;
  sourceType: KnowledgeSourceType;
  title: string;
  language: string;
  method: IngestionMethod;
  /** Trust priority 0-100 (defaults to 50). */
  trustPriority?: number;
  /** Caller-supplied idempotency key; one ingestion per (tenant, key). */
  idempotencyKey?: string;
}

export interface IngestTextInput extends IngestBaseInput {
  method: 'manual_text' | 'markdown';
  text: string;
}

export interface IngestFaqInput extends IngestBaseInput {
  method: 'faq';
  faqs: { question: string; answer: string }[];
}

export interface IngestProjectRecordInput extends IngestBaseInput {
  method: 'project_record';
  /** The project whose facts to import (must equal projectId for scoping). */
  recordProjectId: string;
}

export interface IngestUrlInput extends IngestBaseInput {
  method: 'document_url';
  url: string;
  /** Pre-extracted text (e.g. from an upstream fetch worker). Required in 5A —
   * this module does NOT perform the network fetch itself. */
  extractedText: string;
}

export type IngestInput =
  | IngestTextInput
  | IngestFaqInput
  | IngestProjectRecordInput
  | IngestUrlInput;

export interface IngestResult {
  ok: boolean;
  error?: string;
  sourceId?: string;
  sourceVersionId?: string;
  documentVersionId?: string;
  jobId?: string;
  chunkCount?: number;
  state?: string;
  /** True when an identical source/version already existed (idempotent no-op). */
  deduplicated?: boolean;
  injectionFlagged?: boolean;
}

/** Build the raw text payload for a given ingestion method. */
function buildRawText(input: IngestInput): string {
  switch (input.method) {
    case 'manual_text':
    case 'markdown':
      return input.text;
    case 'faq':
      // Q/A pairs separated by blank lines; chunker keeps each pair atomic.
      return input.faqs.map((f) => `## ${f.question.trim()}\n${f.answer.trim()}`).join('\n\n');
    case 'project_record':
      // Filled in after we read the project facts (see ingestKnowledge).
      return '';
    case 'document_url':
      return input.extractedText;
    default:
      return '';
  }
}

/** Import approved project facts into a deterministic, normalised text block. */
async function buildProjectRecordText(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<string | null> {
  const { data: project } = await supabase
    .from('projects')
    .select(
      'name, developer, category, locality, address, possession_date, price_min, price_max, currency, construction_status, description',
    )
    .eq('id', projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!project) return null;
  const p = project as Record<string, unknown>;

  const { data: configs } = await supabase
    .from('project_configurations')
    .select('label, carpet_area_sqft, base_price')
    .eq('project_id', projectId)
    .eq('tenant_id', tenantId);
  const { data: amenities } = await supabase
    .from('project_amenities')
    .select('name')
    .eq('project_id', projectId)
    .eq('tenant_id', tenantId);

  const lines: string[] = [];
  lines.push(`## Project overview`);
  lines.push(`Name: ${p.name}`);
  if (p.developer) lines.push(`Developer: ${p.developer}`);
  if (p.category) lines.push(`Category: ${p.category}`);
  if (p.locality) lines.push(`Locality: ${p.locality}`);
  if (p.possession_date) lines.push(`Possession: ${p.possession_date}`);
  if (p.construction_status) lines.push(`Construction status: ${p.construction_status}`);
  if (p.description) lines.push(`\n${String(p.description)}`);

  const cfgRows = (configs ?? []) as Record<string, unknown>[];
  if (cfgRows.length > 0) {
    lines.push(`\n## Configurations`);
    for (const c of cfgRows) {
      lines.push(
        `- ${c.label}${c.carpet_area_sqft ? ` | ${c.carpet_area_sqft} sqft` : ''}${
          c.base_price ? ` | base ${p.currency ?? 'INR'} ${c.base_price}` : ''
        }`,
      );
    }
  }
  const amRows = (amenities ?? []) as Record<string, unknown>[];
  if (amRows.length > 0) {
    lines.push(`\n## Amenities`);
    lines.push(amRows.map((a) => `- ${a.name}`).join('\n'));
  }
  return lines.join('\n');
}

export async function ingestKnowledge(
  input: IngestInput,
  supabaseClient?: SupabaseClient,
): Promise<IngestResult> {
  const supabase = supabaseClient ?? (await createSupabaseServerClient());
  const tenantId = input.tenantId;

  // 1. Validate the URL up-front (SSRF) before doing any work.
  if (input.method === 'document_url') {
    const verdict = validateExternalUrl(input.url);
    if (!verdict.ok) {
      await writeAudit({
        action: 'KNOWLEDGE_INGESTION_FAILED',
        tenantId,
        actorUserId: input.actorUserId,
        entityType: 'knowledge_source',
        entityId: null,
        metadata: { method: input.method, reason: verdict.reason ?? 'url_rejected' },
      });
      return { ok: false, error: `url_rejected:${verdict.reason ?? 'unsafe'}` };
    }
  }

  // 2. Build raw text (project_record reads facts first).
  let rawText = buildRawText(input);
  if (input.method === 'project_record') {
    const built = await buildProjectRecordText(
      supabase,
      tenantId,
      (input as IngestProjectRecordInput).recordProjectId,
    );
    if (!built) return { ok: false, error: 'project_not_found' };
    rawText = built;
  }
  if (!rawText || !rawText.trim()) return { ok: false, error: 'empty_content' };

  // 3. Checksum + idempotency.
  const checksum = fnv1aHex(rawText);
  const idempotencyKey =
    input.idempotencyKey ?? `${input.method}:${input.projectId ?? 'global'}:${checksum}`;

  // 3a. Identical-source/version dedupe: an existing approved/active source with
  // the same checksum is a no-op.
  const { data: existingByChecksum } = await supabase
    .from('knowledge_sources')
    .select('id, checksum, state')
    .eq('tenant_id', tenantId)
    .eq('checksum', checksum)
    .limit(1)
    .maybeSingle();
  if (existingByChecksum) {
    return {
      ok: true,
      deduplicated: true,
      sourceId: existingByChecksum.id as string,
      state: existingByChecksum.state as string,
    };
  }

  // 4. Create (or reuse) the durable ingestion job (idempotent by key).
  // NON-PRODUCTION: executed synchronously below. Production = PGMQ worker.
  const { data: job, error: jobErr } = await supabase
    .from('knowledge_ingestion_jobs')
    .insert({
      tenant_id: tenantId,
      project_id: input.projectId,
      method: input.method,
      status: 'received',
      idempotency_key: idempotencyKey,
      payload_hash: checksum,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    // Unique (tenant, idempotency_key) violation = already ingested.
    return { ok: true, deduplicated: true, error: undefined };
  }
  const jobId = job.id as string;

  await writeAudit({
    action: 'KNOWLEDGE_INGESTION_STARTED',
    tenantId,
    actorUserId: input.actorUserId,
    entityType: 'knowledge_ingestion_job',
    entityId: jobId,
    metadata: { method: input.method, projectId: input.projectId },
  });
  await supabase.from('knowledge_ingestion_attempts').insert({
    tenant_id: tenantId,
    job_id: jobId,
    attempt_no: 1,
    status: 'processing',
  });

  // 5. Normalise the text.
  const normalized = normalizeText(rawText);

  // 6. Prompt-injection scan (untrusted content). Flag + record categories.
  const injection = detectInjection(normalized);
  if (injection.detected) {
    // Safe category only — never the malicious text. Security event raised.
    await writeAudit({
      action: 'KNOWLEDGE_INGESTION_FAILED',
      tenantId,
      actorUserId: input.actorUserId,
      entityType: 'knowledge_ingestion_job',
      entityId: jobId,
      // Categorised as a security-relevant ingestion finding; the abuse signal
      // is carried by the dedicated usage/abuse action elsewhere. Here we keep
      // the safe categories only.
      metadata: { injection_categories: injection.categories, method: input.method },
      severity: 'medium',
    });
    await supabase.from('knowledge_ingestion_errors').insert({
      tenant_id: tenantId,
      job_id: jobId,
      category: 'prompt_injection_flagged',
      summary: `categories:${injection.categories.join(',')}`,
    });
  }

  // 7. Create the source (state review_required, never approved).
  const { data: source, error: srcErr } = await supabase
    .from('knowledge_sources')
    .insert({
      tenant_id: tenantId,
      project_id: input.projectId,
      source_type: input.sourceType,
      title: input.title,
      language: input.language,
      trust_priority: input.trustPriority ?? 50,
      owner_id: input.actorUserId,
      state: 'review_required',
      checksum,
      extraction_status: 'extracted',
    })
    .select('id')
    .single();
  if (srcErr || !source) {
    await failJob(supabase, tenantId, jobId, 'source_insert_failed');
    return { ok: false, error: 'source_insert_failed' };
  }
  const sourceId = source.id as string;

  await writeAudit({
    action: 'KNOWLEDGE_SOURCE_CREATED',
    tenantId,
    actorUserId: input.actorUserId,
    entityType: 'knowledge_source',
    entityId: sourceId,
    metadata: { sourceType: input.sourceType, method: input.method },
  });

  // 8. Source version v1.
  const { data: sourceVersion } = await supabase
    .from('knowledge_source_versions')
    .insert({
      tenant_id: tenantId,
      source_id: sourceId,
      version: 1,
      state: 'review_required',
      checksum,
      change_summary: 'Initial ingestion',
      created_by: input.actorUserId,
    })
    .select('id')
    .single();
  const sourceVersionId = (sourceVersion?.id as string | undefined) ?? null;

  // 9. Document + document version (extracted/normalised TEXT only).
  const { data: document } = await supabase
    .from('knowledge_documents')
    .insert({
      tenant_id: tenantId,
      source_id: sourceId,
      project_id: input.projectId,
      title: input.title,
      language: input.language,
    })
    .select('id')
    .single();
  const documentId = document?.id as string | undefined;

  const { data: documentVersion } = await supabase
    .from('knowledge_document_versions')
    .insert({
      tenant_id: tenantId,
      document_id: documentId,
      source_version_id: sourceVersionId,
      version: 1,
      extracted_text: rawText,
      normalized_text: normalized,
      checksum,
      injection_flagged: injection.detected,
      injection_categories: injection.categories,
    })
    .select('id')
    .single();
  const documentVersionId = documentVersion?.id as string | undefined;

  // 10. Deterministic chunking.
  const chunks = chunkDocument(
    { text: normalized, language: input.language, isFaq: input.method === 'faq' },
    {},
  );

  // 11. Embed chunks (mock unless a vetted external adapter is wired).
  const embedder = getEmbeddingProvider();
  let embeddings: {
    vector: number[];
    dimensions: number;
    modelVersion: string;
    development: boolean;
  }[] = [];
  try {
    embeddings = await embedder.embedDocuments(chunks.map((c) => ({ text: c.text })));
  } catch {
    embeddings = chunks.map(() => ({
      vector: [],
      dimensions: 0,
      modelVersion: 'unavailable',
      development: true,
    }));
  }

  // Resolve the tenant's active embedding-model configuration so every stored
  // embedding records WHICH model produced it (mixed-model isolation at query
  // time). The pgvector `embedding` column is kept in sync by a DB trigger from
  // the jsonb `vector` written here (see migration 0018), so the app stays
  // environment-agnostic and never writes raw vector types itself.
  const { data: embCfg } = await supabase
    .from('embedding_model_configs')
    .select('id, model_name')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const embConfigId = (embCfg?.id as string | null) ?? null;
  const embModelName = (embCfg?.model_name as string | null) ?? null;

  // 12. Persist chunks + embeddings.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const { data: chunkRow } = await supabase
      .from('knowledge_chunks')
      .insert({
        tenant_id: tenantId,
        project_id: input.projectId,
        source_id: sourceId,
        source_version_id: sourceVersionId,
        document_version_id: documentVersionId,
        chunk_index: chunk.index,
        heading: chunk.heading,
        language: chunk.language,
        char_start: chunk.charStart,
        char_end: chunk.charEnd,
        token_estimate: chunk.tokenEstimate,
        trust_priority: input.trustPriority ?? 50,
        state: 'review_required',
        checksum: chunk.checksum,
        content: chunk.text,
      })
      .select('id')
      .single();
    const chunkId = chunkRow?.id as string | undefined;
    const emb = embeddings[i];
    if (chunkId && emb && emb.vector.length > 0) {
      await supabase.from('knowledge_chunk_embeddings').insert({
        tenant_id: tenantId,
        project_id: input.projectId,
        chunk_id: chunkId,
        embedding_model_config_id: embConfigId,
        dimensions: emb.dimensions,
        vector: emb.vector,
        model_version: emb.modelVersion,
        model_name: embModelName ?? emb.modelVersion,
        distance_metric: 'cosine',
        checksum: fnv1aHex(emb.vector.join(',')),
        development: emb.development,
      });
    }
  }
  if (chunks.length > 0) {
    await writeAudit({
      action: 'KNOWLEDGE_EMBEDDING_GENERATED',
      tenantId,
      actorUserId: input.actorUserId,
      entityType: 'knowledge_source',
      entityId: sourceId,
      metadata: { chunkCount: chunks.length, development: embeddings[0]?.development ?? true },
    });
  }

  // 13. Approval-state event (draft -> review_required) for the trail.
  await supabase.from('knowledge_approval_events').insert({
    tenant_id: tenantId,
    source_id: sourceId,
    source_version_id: sourceVersionId,
    from_state: 'draft',
    to_state: 'review_required',
    actor_id: input.actorUserId,
    reason: 'Ingested; awaiting review',
  });

  // 14. Complete the job.
  await supabase.from('knowledge_ingestion_attempts').insert({
    tenant_id: tenantId,
    job_id: jobId,
    attempt_no: 2,
    status: 'completed',
  });
  await supabase
    .from('knowledge_ingestion_jobs')
    .update({ status: 'completed', source_id: sourceId, completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);

  // 15. Return a structured result.
  return {
    ok: true,
    sourceId,
    sourceVersionId: sourceVersionId ?? undefined,
    documentVersionId,
    jobId,
    chunkCount: chunks.length,
    state: 'review_required',
    injectionFlagged: injection.detected,
  };
}

async function failJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  category: string,
): Promise<void> {
  await supabase.from('knowledge_ingestion_errors').insert({
    tenant_id: tenantId,
    job_id: jobId,
    category,
  });
  await supabase
    .from('knowledge_ingestion_jobs')
    .update({ status: 'rejected', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);
}

/**
 * Binary file upload extraction is DISABLED in Phase 5A. A local/dev-only stub
 * is provided so the surface exists but never processes binary content here.
 * Production must run extraction in a sandboxed, durable worker and feed the
 * resulting text into `ingestKnowledge({ method: 'document_url', extractedText })`.
 */
export function binaryUploadDisabled(): { enabled: false; reason: string } {
  return { enabled: false, reason: 'binary_extraction_disabled_phase_5a' };
}
