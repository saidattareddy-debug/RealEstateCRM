/**
 * Knowledge lifecycle, approval rules, version activation and conflict detection
 * (Phase 5A §4, §5, §14). Pure & deterministic. Only `approved` + active +
 * in-effect knowledge is ever retrievable (enforced again at the DB/RLS layer).
 */

export type KnowledgeState =
  | 'draft'
  | 'processing'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'archived'
  | 'failed';

export type KnowledgeSourceType =
  | 'project_overview'
  | 'approved_faq'
  | 'brochure'
  | 'floor_plan'
  | 'amenity'
  | 'location'
  | 'payment_plan'
  | 'offer'
  | 'policy'
  | 'sales_script'
  | 'legal_disclaimer'
  | 'manual'
  | 'imported_facts'
  | 'general_guidance';

const TRANSITIONS: Record<KnowledgeState, KnowledgeState[]> = {
  draft: ['processing', 'review_required', 'rejected', 'archived', 'failed'],
  processing: ['review_required', 'failed', 'archived'],
  review_required: ['approved', 'rejected', 'archived', 'failed'],
  approved: ['superseded', 'archived'],
  rejected: ['draft', 'archived'],
  superseded: ['archived'],
  archived: [],
  failed: ['draft', 'archived'],
};

export function canTransition(from: KnowledgeState, to: KnowledgeState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Only approved + active + within effective/expiry window is retrievable. */
export function isRetrievable(
  state: KnowledgeState,
  opts: {
    now: Date;
    effectiveAt?: string | null;
    expiresAt?: string | null;
    machineTranslatedUnapproved?: boolean;
  },
): boolean {
  if (state !== 'approved') return false;
  if (opts.machineTranslatedUnapproved) return false;
  const t = opts.now.getTime();
  if (opts.effectiveAt && t < new Date(opts.effectiveAt).getTime()) return false;
  if (opts.expiresAt && t > new Date(opts.expiresAt).getTime()) return false;
  return true;
}

export interface ApprovalRequest {
  state: KnowledgeState;
  hasApprover: boolean;
  hasReason: boolean;
  injectionFlagged: boolean;
  extractionComplete: boolean;
}

export interface ApprovalResult {
  ok: boolean;
  error?: string;
}

/** Approval is permitted only from review_required, with approver + reason, and
 * never while an unresolved prompt-injection flag is present. */
export function canApprove(req: ApprovalRequest): ApprovalResult {
  if (req.state !== 'review_required') return { ok: false, error: 'not_in_review' };
  if (!req.extractionComplete) return { ok: false, error: 'extraction_incomplete' };
  if (req.injectionFlagged) return { ok: false, error: 'injection_unresolved' };
  if (!req.hasApprover) return { ok: false, error: 'approver_required' };
  if (!req.hasReason) return { ok: false, error: 'reason_required' };
  return { ok: true };
}

/** Approving a new version supersedes the prior active one (rollback = approve
 * an older version as a NEW active version). Returns the version that becomes
 * superseded, if any. */
export function activateVersion(
  newVersionId: string,
  currentActiveId: string | null,
): { activate: string; supersede: string | null } {
  return { activate: newVersionId, supersede: currentActiveId };
}

// --- Conflict detection ----------------------------------------------------

export type ConflictType =
  | 'price'
  | 'possession_date'
  | 'amenity'
  | 'unit_area'
  | 'payment_plan'
  | 'offer'
  | 'location_distance';

export interface KnowledgeClaim {
  sourceId: string;
  sourceVersionId: string;
  type: ConflictType;
  /** Normalized comparable value (number for price/area/distance, ISO for dates,
   * lowercased string otherwise). */
  value: string | number;
  trustPriority: number;
}

export interface DetectedConflict {
  type: ConflictType;
  claims: KnowledgeClaim[];
  /** True when all claims share the top trust priority (cannot auto-resolve). */
  ambiguous: boolean;
}

/** Group claims by type; a conflict exists when ≥2 distinct values appear. */
export function detectConflicts(claims: readonly KnowledgeClaim[]): DetectedConflict[] {
  const byType = new Map<ConflictType, KnowledgeClaim[]>();
  for (const c of claims) {
    byType.set(c.type, [...(byType.get(c.type) ?? []), c]);
  }
  const conflicts: DetectedConflict[] = [];
  for (const [type, group] of byType) {
    const distinct = new Set(group.map((c) => String(c.value)));
    if (distinct.size > 1) {
      const maxTrust = Math.max(...group.map((c) => c.trustPriority));
      const topClaims = group.filter((c) => c.trustPriority === maxTrust);
      const topValues = new Set(topClaims.map((c) => String(c.value)));
      conflicts.push({ type, claims: group, ambiguous: topValues.size > 1 });
    }
  }
  return conflicts;
}

/** Structured/approved data wins ONLY when policy grants it priority AND it is
 * the unique highest-trust claim. Otherwise the conflict needs human review. */
export function resolveConflict(
  conflict: DetectedConflict,
  policyPrefersStructured: boolean,
): { resolved: boolean; winner: KnowledgeClaim | null } {
  if (!policyPrefersStructured || conflict.ambiguous) return { resolved: false, winner: null };
  const maxTrust = Math.max(...conflict.claims.map((c) => c.trustPriority));
  const top = conflict.claims.filter((c) => c.trustPriority === maxTrust);
  return top.length === 1 ? { resolved: true, winner: top[0]! } : { resolved: false, winner: null };
}
