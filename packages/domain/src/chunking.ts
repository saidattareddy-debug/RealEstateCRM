/**
 * Deterministic knowledge chunking (Phase 5A §7). Pure & reproducible: identical
 * input + config always yields identical chunks and checksums. No runtime or
 * framework dependencies.
 *
 * Rules:
 *  - Prefer semantic sections (markdown headings).
 *  - Preserve FAQ question/answer pairs as single chunks.
 *  - Never split inside a paragraph, a list item, or a "table row" line — so
 *    prices stay with their units/conditions and payment-plan steps stay intact.
 *  - Never mix headings/sections across chunks.
 *  - Over-long single tokens (e.g. URLs) are emitted whole, never broken.
 */

/** Stable, dependency-free FNV-1a (32-bit) hex hash for chunk/source checksums. */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ChunkConfig {
  /** Soft max characters per chunk (default 1000). */
  maxChars?: number;
  /** Approx chars per token for the estimate (default 4). */
  charsPerToken?: number;
}

export interface ChunkInput {
  text: string;
  language: string;
  /** FAQ sources keep Q/A pairs atomic. */
  isFaq?: boolean;
}

export interface Chunk {
  index: number;
  heading: string | null;
  language: string;
  charStart: number;
  charEnd: number;
  text: string;
  tokenEstimate: number;
  checksum: string;
}

/** Normalize text deterministically (line endings, trailing space, blank runs). */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Section {
  heading: string | null;
  body: string;
}

function splitSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || heading) sections.push({ heading, body });
    buf = [];
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!.trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Atomic blocks within a section: list items, table rows, FAQ pairs, paragraphs. */
function splitBlocks(body: string): string[] {
  if (!body.trim()) return [];
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Split an over-long paragraph on sentence boundaries; never break a token. */
function splitLongBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  // A single token longer than maxChars (e.g. a URL) is kept whole.
  if (!/\s/.test(block.trim())) return [block];
  // A list/table block (multi-line) is kept atomic to protect payment-plan steps.
  if (/\n/.test(block) && /^(\s*([-*+]|\d+[.)])\s+|\|)/.test(block)) return [block];
  const sentences = block.match(/[^.!?]+[.!?]+|\S+$|[^.!?]+$/g) ?? [block];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (cur && (cur + ' ' + piece).length > maxChars) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkDocument(input: ChunkInput, config: ChunkConfig = {}): Chunk[] {
  const maxChars = config.maxChars ?? 1000;
  const charsPerToken = config.charsPerToken ?? 4;
  const normalized = normalizeText(input.text);
  if (!normalized) return [];

  const chunks: Chunk[] = [];
  let index = 0;
  let cursor = 0;

  for (const section of splitSections(normalized)) {
    const blocks = splitBlocks(section.body);
    let packed: string[] = [];
    let packedLen = 0;
    const emit = () => {
      if (packed.length === 0) return;
      const text = packed.join('\n\n');
      const found = normalized.indexOf(text, cursor);
      const charStart = found < 0 ? cursor : found;
      const charEnd = charStart + text.length;
      cursor = charEnd;
      chunks.push({
        index: index++,
        heading: section.heading,
        language: input.language,
        charStart,
        charEnd,
        text,
        tokenEstimate: Math.ceil(text.length / charsPerToken),
        checksum: fnv1aHex(`${section.heading ?? ''}|${text}`),
      });
      packed = [];
      packedLen = 0;
    };
    for (const block of blocks) {
      // FAQ sources keep each question/answer block atomic (never sentence-split),
      // so a Q and its A are always retrieved together.
      const pieces = input.isFaq ? [block] : splitLongBlock(block, maxChars);
      for (const piece of pieces) {
        if (packedLen > 0 && packedLen + piece.length > maxChars) emit();
        packed.push(piece);
        packedLen += piece.length + 2;
      }
    }
    emit();
  }
  return chunks;
}
