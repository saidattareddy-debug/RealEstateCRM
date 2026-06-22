/**
 * Deterministic duplicate detection (MASTER_SPEC §9). Pure, DB-independent.
 * Never relies on exact names alone; combines normalized phone, email, source
 * lead id, and fuzzy name + a second identifier. Returns confidence levels.
 */

export type DuplicateConfidence = 'exact' | 'probable' | 'possible' | 'none';

export interface ContactKey {
  id: string;
  fullName?: string | null;
  phoneE164?: string | null;
  phoneNational?: string | null;
  altPhoneNational?: string | null;
  email?: string | null;
  sourceLeadId?: string | null;
  source?: string | null;
  campaign?: string | null;
  /** ISO timestamp; used for the same-campaign-within-window heuristic. */
  createdAt?: string | null;
}

export interface DuplicateMatch {
  leadId: string;
  confidence: Exclude<DuplicateConfidence, 'none'>;
  signals: string[];
}

/**
 * Normalize a phone to E.164 + a prefix-insensitive national form.
 * Pragmatic, India-default. Returns nulls for unusable input.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: 'IN' = 'IN',
): { e164: string | null; national: string | null } {
  if (!raw) return { e164: null, national: null };
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7) return { e164: null, national: null };

  const cc = defaultCountry === 'IN' ? '91' : '';
  let e164: string;
  let national: string;

  if (hasPlus) {
    e164 = '+' + digits;
    national = digits.length > 10 ? digits.slice(-10) : digits;
  } else if (digits.length === 10) {
    e164 = '+' + cc + digits;
    national = digits;
  } else if (digits.length === 12 && digits.startsWith(cc)) {
    e164 = '+' + digits;
    national = digits.slice(-10);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    const ten = digits.slice(1);
    e164 = '+' + cc + ten;
    national = ten;
  } else {
    e164 = '+' + digits;
    national = digits.slice(-10);
  }
  return { e164, national };
}

const STOP = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'the']);

function nameTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Jaccard similarity over name tokens (0..1). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const NAME_MATCH_THRESHOLD = 0.5;
const CAMPAIGN_WINDOW_MS = 48 * 3_600_000; // 48h

function sameNationalPhone(a: ContactKey, b: ContactKey): boolean {
  const an = [a.phoneNational, a.altPhoneNational].filter(Boolean);
  const bn = [b.phoneNational, b.altPhoneNational].filter(Boolean);
  return an.some((x) => bn.includes(x));
}

/** Classify the duplicate relationship between an incoming lead and an existing one. */
export function classifyPair(incoming: ContactKey, existing: ContactKey): DuplicateMatch | null {
  const signals: string[] = [];

  const sameEmail =
    !!incoming.email &&
    !!existing.email &&
    incoming.email.trim().toLowerCase() === existing.email.trim().toLowerCase();
  const sameE164 = !!incoming.phoneE164 && incoming.phoneE164 === existing.phoneE164;
  const sameNational = sameNationalPhone(incoming, existing);
  const sameSourceId =
    !!incoming.sourceLeadId &&
    incoming.sourceLeadId === existing.sourceLeadId &&
    incoming.source === existing.source;
  const sim = nameSimilarity(incoming.fullName, existing.fullName);
  const nameMatch = sim >= NAME_MATCH_THRESHOLD;

  // Exact: same full E.164 phone, or same email.
  if (sameE164) signals.push('phone_e164');
  if (sameEmail) signals.push('email');
  if (sameE164 || sameEmail) return { leadId: existing.id, confidence: 'exact', signals };

  // Probable: same national phone + a second identifier, or same source lead id.
  if (sameSourceId) {
    signals.push('source_lead_id');
    return { leadId: existing.id, confidence: 'probable', signals };
  }
  if (sameNational && (nameMatch || sameEmail)) {
    signals.push('phone_national', nameMatch ? 'fuzzy_name' : 'email');
    return { leadId: existing.id, confidence: 'probable', signals };
  }

  // Possible: national phone alone, or fuzzy name + same campaign within window.
  if (sameNational) {
    signals.push('phone_national');
    return { leadId: existing.id, confidence: 'possible', signals };
  }
  if (
    nameMatch &&
    !!incoming.campaign &&
    incoming.campaign === existing.campaign &&
    incoming.createdAt &&
    existing.createdAt &&
    Math.abs(new Date(incoming.createdAt).getTime() - new Date(existing.createdAt).getTime()) <=
      CAMPAIGN_WINDOW_MS
  ) {
    signals.push('fuzzy_name', 'same_campaign_window');
    return { leadId: existing.id, confidence: 'possible', signals };
  }

  return null;
}

const RANK: Record<Exclude<DuplicateConfidence, 'none'>, number> = {
  exact: 3,
  probable: 2,
  possible: 1,
};

/** Find all duplicate candidates for an incoming lead, strongest first. */
export function findDuplicates(
  incoming: ContactKey,
  existing: readonly ContactKey[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const e of existing) {
    if (e.id === incoming.id) continue;
    const m = classifyPair(incoming, e);
    if (m) matches.push(m);
  }
  return matches.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
}

export function bestDuplicate(
  incoming: ContactKey,
  existing: readonly ContactKey[],
): DuplicateMatch | null {
  return findDuplicates(incoming, existing)[0] ?? null;
}
