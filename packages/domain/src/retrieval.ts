/**
 * Deterministic hybrid-retrieval merge, rerank and dedup (Phase 5A §10). The
 * tenant/project/approval/effective/language filtering happens at the SQL+RLS
 * layer; this pure function takes already-scoped lexical + vector candidates and
 * produces a stable, deduplicated, reranked result set. No randomness — the same
 * candidates always produce the same order.
 */

export interface Candidate {
  chunkId: string;
  sourceId: string;
  sourceVersionId: string;
  language: string;
  trustPriority: number;
  /** Lexical (full-text) score in [0,1], 0 if not matched lexically. */
  lexicalScore: number;
  /** Vector similarity in [0,1], 0 if not matched by vector. */
  vectorScore: number;
  /** Exact approved-FAQ hit. */
  exactFaq: boolean;
  /** Source effective recency in [0,1] (1 = newest). */
  recency: number;
  /** Normalized text used for overlap-dedup. */
  text: string;
}

export interface RerankConfig {
  lexicalWeight?: number; // 0.35
  vectorWeight?: number; // 0.4
  trustWeight?: number; // 0.15
  recencyWeight?: number; // 0.1
  faqBoost?: number; // 0.25
  maxResults?: number; // 8
  /** Query language; same-language candidates are preferred. */
  queryLanguage?: string;
}

export interface RankedChunk extends Candidate {
  score: number;
}

function combinedScore(
  c: Candidate,
  cfg: Required<Omit<RerankConfig, 'queryLanguage'>>,
  langMatch: boolean,
): number {
  const trust = Math.min(1, c.trustPriority / 100);
  let score =
    c.lexicalScore * cfg.lexicalWeight +
    c.vectorScore * cfg.vectorWeight +
    trust * cfg.trustWeight +
    c.recency * cfg.recencyWeight +
    (c.exactFaq ? cfg.faqBoost : 0);
  if (!langMatch) score *= 0.85; // mild penalty for cross-language fallback
  return score;
}

/** Jaccard token overlap for near-duplicate detection. */
function overlap(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function rerank(candidates: readonly Candidate[], config: RerankConfig = {}): RankedChunk[] {
  const cfg = {
    lexicalWeight: config.lexicalWeight ?? 0.35,
    vectorWeight: config.vectorWeight ?? 0.4,
    trustWeight: config.trustWeight ?? 0.15,
    recencyWeight: config.recencyWeight ?? 0.1,
    faqBoost: config.faqBoost ?? 0.25,
    maxResults: config.maxResults ?? 8,
  };
  const scored: RankedChunk[] = candidates.map((c) => ({
    ...c,
    score: combinedScore(c, cfg, !config.queryLanguage || c.language === config.queryLanguage),
  }));
  // Stable sort: score desc, then trust desc, then chunkId asc (deterministic).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.trustPriority !== a.trustPriority) return b.trustPriority - a.trustPriority;
    return a.chunkId < b.chunkId ? -1 : 1;
  });
  // Deduplicate near-identical chunks (keep the higher-ranked one).
  const kept: RankedChunk[] = [];
  for (const c of scored) {
    if (kept.some((k) => k.chunkId === c.chunkId || overlap(k.text, c.text) >= 0.9)) continue;
    kept.push(c);
    if (kept.length >= cfg.maxResults) break;
  }
  return kept;
}

/** Count of independent approved SOURCES represented (not chunks). */
export function independentSourceCount(chunks: readonly RankedChunk[]): number {
  return new Set(chunks.map((c) => c.sourceId)).size;
}
