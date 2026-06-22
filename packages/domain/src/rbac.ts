import type { PermissionKey } from '@re/validation';

/**
 * Deterministic, framework- and DB-independent authorization logic.
 * AI/UI/DB layers depend on this; this depends on nothing but @re/validation.
 * See docs/SECURITY.md §2 and docs/PERMISSIONS_MATRIX.md.
 */

/**
 * Read-scope implication: a broader read grant implies the narrower ones.
 * Holding `leads.read.all` satisfies a check for `leads.read.team` or
 * `leads.read.assigned`, etc.
 */
const SCOPE_IMPLICATIONS: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'leads.read.all': ['leads.read.team', 'leads.read.assigned'],
  'leads.read.team': ['leads.read.assigned'],
  'conversations.read.private': ['conversations.read.assigned'],
};

export interface EffectivePermissionsInput {
  /** Permissions from the user's role(s) in the active tenant. */
  rolePermissions: readonly PermissionKey[];
  /** Per-user explicit grants (user_permissions). */
  grants?: readonly PermissionKey[];
  /** Per-user explicit revocations (user_permissions). Applied last. */
  revocations?: readonly PermissionKey[];
}

/**
 * Resolve the effective permission set: (role ∪ grants) − revocations,
 * expanded with scope implications. Revocation wins over grant.
 */
export function resolveEffectivePermissions(input: EffectivePermissionsInput): Set<PermissionKey> {
  const { rolePermissions, grants = [], revocations = [] } = input;
  const revoked = new Set(revocations);
  const effective = new Set<PermissionKey>();

  for (const p of [...rolePermissions, ...grants]) {
    if (!revoked.has(p)) effective.add(p);
  }

  // Expand implications (only for non-revoked source perms).
  for (const p of [...effective]) {
    const implied = SCOPE_IMPLICATIONS[p];
    if (implied) {
      for (const i of implied) {
        if (!revoked.has(i)) effective.add(i);
      }
    }
  }

  return effective;
}

/** True if the effective set satisfies the required permission. */
export function hasPermission(
  effective: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  return effective.has(required);
}

/** True if ALL required permissions are satisfied. */
export function hasAllPermissions(
  effective: ReadonlySet<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  return required.every((r) => effective.has(r));
}

/** True if ANY of the required permissions are satisfied. */
export function hasAnyPermission(
  effective: ReadonlySet<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  return required.some((r) => effective.has(r));
}

export interface LeadAccessContext {
  effective: ReadonlySet<PermissionKey>;
  /** Profile id of the requesting user. */
  profileId: string;
  /** Agent profile ids currently assigned to the lead. */
  assignedAgentIds: readonly string[];
}

/**
 * Can the user read a specific lead?
 * - `leads.read.all` → yes.
 * - `leads.read.team` → yes (team-scope; final team membership is enforced by RLS).
 * - `leads.read.assigned` → only if assigned to them.
 * Mirrors the RLS policy in docs/SECURITY.md §3.2 (defense in depth).
 */
export function canReadLead(ctx: LeadAccessContext): boolean {
  if (ctx.effective.has('leads.read.all')) return true;
  if (ctx.effective.has('leads.read.team')) return true;
  if (ctx.effective.has('leads.read.assigned')) {
    return ctx.assignedAgentIds.includes(ctx.profileId);
  }
  return false;
}
