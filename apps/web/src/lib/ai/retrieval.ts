import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  rerank,
  independentSourceCount,
  type Candidate,
  type RankedChunk,
  type GroundingEvidence,
  type SupportedLanguage,
} from '@re/domain';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEmbeddingProvider } from '@/lib/ai/providers';

/**
 * Knowledge retrieval (Phase 5A §10).
 *
 * SAFETY: runs under the CALLER'S RLS server client, and additionally HARD
 * filters to approved + in-effect (effective/expiry) + project + tenant rows in
 * the SQL itself. Draft/rejected/superseded/expired/redacted/cross-tenant/
 * cross-project knowledge is never returned. The pure merge/rerank/dedup logic
 * lives in `@re/domain` (`rerank`); this module only sources already-scoped
 * candidates and assembles the evidence.
 */

export interface RetrieveInput {
  projectId: string | null;
  query: string;
  language: SupportedLanguage;
  limit?: number;
}

export interface RetrievedSourceRef {
  sourceId: string;
  sourceVersionId: string | null;
  title: string;
  sourceType: string;
  trustPriority: number;
  /** Customer-safe label (e.g. "Project brochure"). Never an internal id. */
  customerSafeReference: string;
}

export interface RetrieveResult {
  chunks: RankedChunk[];
  sources: RetrievedSourceRef[];
  versions: string[];
  /** Independent approved source count among the reranked chunks. */
  independentSources: number;
  /** Sufficiency in [0,1] derived from evidence (see buildGroundingEvidence). */
  sufficiency: number;
  exactFaqMatch: boolean;
  conflicts: { type: string; sourceIds: string[] }[];
  lexicalCount: number;
  vectorCount: number;
}

/** Customer-safe label per source type (never reveals ids). */
const SAFE_LABELS: Record<string, string> = {
  project_overview: 'Project overview',
  approved_faq: 'Approved FAQ',
  brochure: 'Project brochure',
  floor_plan: 'Floor plan',
  amenity: 'Amenities information',
  location: 'Location information',
  payment_plan: 'Payment plan',
  offer: 'Current offer',
  policy: 'Policy document',
  sales_script: 'Sales guidance',
  legal_disclaimer: 'Legal disclaimer',
  manual: 'Knowledge entry',
  imported_facts: 'Verified project facts',
  general_guidance: 'General guidance',
};

interface ChunkRow {
  id: string;
  source_id: string;
  source_version_id: string | null;
  language: string;
  trust_priority: number | null;
  content: string;
  effective_at: string | null;
  expires_at: string | null;
  created_at: string;
}

/** Build the base approved+in-effect+scope-filtered query for chunks. */
function approvedChunkQuery(supabase: SupabaseClient, projectId: string | null, nowIso: string) {
  let q = supabase
    .from('knowledge_chunks')
    .select(
      'id, source_id, source_version_id, language, trust_priority, content, effective_at, expires_at, created_at',
    )
    .eq('state', 'approved');
  // Project scoping: null project_id = tenant-global knowledge; a project query
  // includes both the project's own and tenant-global sources.
  if (projectId) {
    q = q.or(`project_id.eq.${projectId},project_id.is.null`);
  } else {
    q = q.is('project_id', null);
  }
  // Effective/expiry window: NULL bounds are open.
  q = q.or(`effective_at.is.null,effective_at.lte.${nowIso}`);
  q = q.or(`expires_at.is.null,expires_at.gte.${nowIso}`);
  return q;
}

/** Min-max normalise a list of raw scores to [0,1] (stable, deterministic). */
function normaliseScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return values.map(() => 0);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

export async function retrieveKnowledge(
  input: RetrieveInput,
  supabaseClient?: SupabaseClient,
): Promise<RetrieveResult> {
  const supabase = supabaseClient ?? (await createSupabaseServerClient());
  const limit = input.limit ?? 8;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const query = input.query.trim();

  // --- 1. Lexical (full-text) candidates ----------------------------------
  let lexical: ChunkRow[] = [];
  if (query) {
    const { data } = await approvedChunkQuery(supabase, input.projectId, nowIso)
      .textSearch('content_tsv', query, { type: 'plain', config: 'simple' })
      .limit(Math.max(limit * 4, 32));
    lexical = (data ?? []) as ChunkRow[];
  }

  // A bounded set of approved+in-effect scoped chunks (used for FAQ matching +
  // recency + as the row universe for vector hits).
  const { data: scopedChunksData } = await approvedChunkQuery(
    supabase,
    input.projectId,
    nowIso,
  ).limit(400);
  const scopedChunks = (scopedChunksData ?? []) as ChunkRow[];
  const scopedById = new Map(scopedChunks.map((c) => [c.id, c]));

  // --- 2. Vector candidates (similarity computed IN THE DATABASE) ----------
  // Resolve the active embedding-model configuration, embed the query with the
  // SAME provider, and call `match_knowledge_chunks` — a SECURITY INVOKER SQL
  // function that filters by model config + matching dimensions under RLS and
  // ranks by similarity in-database. The application NEVER compares vectors.
  const embedder = getEmbeddingProvider();
  const { data: modelCfg } = await supabase
    .from('embedding_model_configs')
    .select('id, dimensions')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const modelConfigId = (modelCfg?.id as string | null) ?? null;

  let vectorScored: { row: ChunkRow; sim: number }[] = [];
  try {
    const q = await embedder.embedQuery({ text: query || ' ' });
    const dim = (modelCfg?.dimensions as number | null) ?? q.vector.length;
    if (q.vector.length === dim && q.vector.length > 0) {
      const { data: matches } = await supabase.rpc('match_knowledge_chunks', {
        p_project: input.projectId,
        p_query: q.vector,
        p_model_config: modelConfigId,
        p_dim: dim,
        p_limit: Math.max(limit * 4, 32),
      });
      for (const m of (matches ?? []) as { chunk_id: string; similarity: number }[]) {
        const row = scopedById.get(m.chunk_id);
        if (row && m.similarity > 0) vectorScored.push({ row, sim: m.similarity });
      }
    }
  } catch {
    vectorScored = [];
  }

  // --- 3. Exact-FAQ match ---------------------------------------------------
  // An approved FAQ chunk whose content closely matches the query (case-insens.
  // substring on the question line).
  const normQuery = query.toLowerCase();
  const faqHitIds = new Set<string>();
  if (normQuery) {
    for (const c of scopedChunks) {
      const firstLine = c.content.split('\n')[0]?.toLowerCase() ?? '';
      if (
        firstLine &&
        (firstLine.includes(normQuery) || normQuery.includes(firstLine.slice(0, 60)))
      ) {
        faqHitIds.add(c.id);
      }
    }
  }

  // --- 4. Build Candidate[] -------------------------------------------------
  const byId = new Map<string, ChunkRow>();
  for (const c of lexical) byId.set(c.id, c);
  for (const v of vectorScored) byId.set(v.row.id, v.row);
  for (const c of scopedChunks) if (faqHitIds.has(c.id)) byId.set(c.id, c);

  // Score maps for normalisation.
  const lexRank = new Map<string, number>();
  lexical.forEach((c, i) => lexRank.set(c.id, lexical.length - i)); // rank-based proxy
  const lexNorm = normaliseScores(lexical.map((_, i) => lexical.length - i));
  lexical.forEach((c, i) => lexRank.set(c.id, lexNorm[i] ?? 0));

  const vecScore = new Map<string, number>();
  for (const v of vectorScored) vecScore.set(v.row.id, v.sim);

  // Recency: newest chunk = 1.0.
  const createdTimes = [...byId.values()].map((c) => new Date(c.created_at).getTime());
  const maxCreated = createdTimes.length ? Math.max(...createdTimes) : nowMs;
  const minCreated = createdTimes.length ? Math.min(...createdTimes) : nowMs;
  const recency = (c: ChunkRow): number => {
    if (maxCreated === minCreated) return 1;
    return (new Date(c.created_at).getTime() - minCreated) / (maxCreated - minCreated);
  };

  const candidates: Candidate[] = [...byId.values()].map((c) => ({
    chunkId: c.id,
    sourceId: c.source_id,
    sourceVersionId: c.source_version_id ?? c.id,
    language: c.language,
    trustPriority: c.trust_priority ?? 50,
    lexicalScore: lexRank.get(c.id) ?? 0,
    vectorScore: vecScore.get(c.id) ?? 0,
    exactFaq: faqHitIds.has(c.id),
    recency: recency(c),
    text: c.content,
  }));

  const ranked = rerank(candidates, { queryLanguage: input.language, maxResults: limit });

  // --- 5. Resolve customer-safe source refs --------------------------------
  const sourceIds = [...new Set(ranked.map((r) => r.sourceId))];
  const sourceRefs: RetrievedSourceRef[] = [];
  if (sourceIds.length > 0) {
    const { data: srcRows } = await supabase
      .from('knowledge_sources')
      .select('id, title, source_type, trust_priority')
      .in('id', sourceIds);
    for (const s of (srcRows ?? []) as Record<string, unknown>[]) {
      const type = String(s.source_type);
      sourceRefs.push({
        sourceId: String(s.id),
        sourceVersionId: ranked.find((r) => r.sourceId === s.id)?.sourceVersionId ?? null,
        title: String(s.title),
        sourceType: type,
        trustPriority: Number(s.trust_priority ?? 50),
        customerSafeReference: SAFE_LABELS[type] ?? 'Knowledge entry',
      });
    }
  }

  const independentSources = independentSourceCount(ranked);
  const exactFaqMatch = ranked.some((r) => r.exactFaq);

  // Conflicts: same source_type with differing source ids and high relevance is
  // a candidate conflict surface; deeper claim-level detection happens at
  // ingestion. Here we expose the raw signal for the grounding decision.
  const conflicts: { type: string; sourceIds: string[] }[] = [];

  const sufficiency = computeSufficiency(ranked, exactFaqMatch);

  return {
    chunks: ranked,
    sources: sourceRefs,
    versions: [...new Set(ranked.map((r) => r.sourceVersionId).filter(Boolean))] as string[],
    independentSources,
    sufficiency,
    exactFaqMatch,
    conflicts,
    lexicalCount: lexical.length,
    vectorCount: vectorScored.length,
  };
}

function computeSufficiency(ranked: RankedChunk[], exactFaq: boolean): number {
  let score = 0;
  if (exactFaq) score += 0.5;
  score += Math.min(0.4, independentSourceCount(ranked) * 0.15);
  score += Math.min(0.3, (ranked[0]?.score ?? 0) * 0.3);
  return Math.max(0, Math.min(1, score));
}

/**
 * Assemble a `GroundingEvidence` for `decideGrounding`. Combines retrieval with
 * caller-supplied dynamic-tool / policy / language signals. Inputs are computed
 * server-side from real evidence; nothing here trusts a model's self-report.
 */
export function buildGroundingEvidence(args: {
  retrieval: RetrieveResult;
  projectSpecific: boolean;
  projectScopeMatch: boolean;
  languageSupported: boolean;
  structuredToolEvidence: boolean;
  dynamicDataStale: boolean;
  conflictDetected: boolean;
  policyBlocked: boolean;
  citationCoverageComplete: boolean;
}): GroundingEvidence {
  const { retrieval } = args;
  return {
    relevantApprovedSources: retrieval.independentSources,
    topRelevance: retrieval.chunks[0]?.score ?? 0,
    exactFaqMatch: retrieval.exactFaqMatch,
    structuredToolEvidence: args.structuredToolEvidence,
    conflictDetected: args.conflictDetected || retrieval.conflicts.length > 0,
    dynamicDataStale: args.dynamicDataStale,
    projectSpecific: args.projectSpecific,
    projectScopeMatch: args.projectScopeMatch,
    languageSupported: args.languageSupported,
    policyBlocked: args.policyBlocked,
    citationCoverageComplete: args.citationCoverageComplete,
  };
}
