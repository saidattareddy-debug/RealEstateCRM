/**
 * Phase 7B — live-provider activation readiness (PURE, no IO).
 *
 * This module models the decision of whether a real external provider adapter
 * (WhatsApp Cloud, Gmail/IMAP/SMTP, a property portal, …) may be switched from
 * the Phase-7A inert stub to a live, network-performing adapter. It is the
 * "go-live decision engine": deterministic, unit-tested, and framework/DB free.
 *
 * Two-key safety model (mirrors the proven `LIVE_SEND_MASTER_SWITCH` pattern):
 *
 *   1. OPERATOR key  — `INTEGRATION_LIVE_PROVIDERS_ENABLED` (env, default false)
 *      plus the external prerequisites (verified credentials present, verified
 *      webhook domain, provider app review approved, paid-service approval,
 *      compliance/privacy approval, a passed sandbox smoke, a named approver).
 *      Together these make `operationalReady` true.
 *
 *   2. ENGINEERING key — `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED`, a COMPILE-TIME
 *      constant that is `false` until the real network adapters are actually
 *      built and reviewed in a future Phase-7B implementation PR.
 *
 * The headline invariant, proven by tests: `evaluateProviderActivation` can
 * NEVER return `allowed: true` while `LIVE_PROVIDER_ACTIVATION_IMPLEMENTED` is
 * `false` — regardless of every operator prerequisite being satisfied. Operator
 * configuration alone can never cause a live external connection or send. This
 * keeps the controlled-MVP guarantee ("automatic/real external IO is impossible")
 * intact while the operator-facing prerequisites are tracked explicitly.
 */

/**
 * ENGINEERING key. The real, network-performing provider adapters are NOT yet
 * implemented — `apps/web/src/lib/integrations/registry.ts` still resolves every
 * provider to a mock, and the "real" path is an inert stub that throws
 * `not_enabled_phase_7a`. Flipping this to `true` is a separately reviewed
 * Phase-7B implementation PR that ships the real adapters; it is NOT a config
 * change. Until then, nothing can be activated.
 */
export const LIVE_PROVIDER_ACTIVATION_IMPLEMENTED = false as const;

/** Operator prerequisites that must each be satisfied before go-live. */
export type ActivationBlocker =
  | 'engineering_not_implemented'
  | 'profile_not_full'
  | 'runtime_flag_off'
  | 'credentials_absent'
  | 'webhook_domain_unverified'
  | 'provider_review_not_approved'
  | 'paid_service_not_approved'
  | 'compliance_not_approved'
  | 'sandbox_smoke_not_passed'
  | 'no_named_approver';

export interface ProviderActivationInputs {
  /** Deployment profile. Live providers require `full`; `controlled_mvp` is always blocked. */
  deploymentProfile: 'controlled_mvp' | 'full';
  /** The operator runtime flag (`INTEGRATION_LIVE_PROVIDERS_ENABLED`). */
  runtimeFlagEnabled: boolean;
  /**
   * Whether verified credentials EXIST for this provider — a metadata-only
   * boolean. The actual secret is never passed to, stored by, or returned from
   * this pure module.
   */
  credentialsPresent: boolean;
  /** The provider's inbound webhook domain has been verified with the provider. */
  webhookDomainVerified: boolean;
  /** The provider app/business review (e.g. Meta app review) is approved. */
  providerAppReviewApproved: boolean;
  /** Paid-service usage for this provider has been explicitly approved. */
  paidServiceApproved: boolean;
  /** Compliance / privacy / consent-wording sign-off is recorded. */
  complianceApproved: boolean;
  /** A sandbox/fixture smoke against the provider has passed. */
  sandboxSmokePassed: boolean;
  /** The human who approved this activation (audit). Empty/blank = none. */
  namedApprover: string | null;
}

export interface ProviderActivationDecision {
  /** The only field that gates a real connection. ALWAYS false until the engineering key flips. */
  allowed: boolean;
  /** All operator prerequisites satisfied (independent of the engineering key). */
  operationalReady: boolean;
  /** Whether the real adapters are implemented (the compile-time engineering key). */
  codePathImplemented: boolean;
  /** Every unmet requirement, in a stable order. */
  blockers: ActivationBlocker[];
  /** A single, user-safe summary reason. */
  summary: string;
}

const REQUIREMENTS: ReadonlyArray<{
  blocker: ActivationBlocker;
  ok: (i: ProviderActivationInputs) => boolean;
}> = [
  { blocker: 'profile_not_full', ok: (i) => i.deploymentProfile === 'full' },
  { blocker: 'runtime_flag_off', ok: (i) => i.runtimeFlagEnabled === true },
  { blocker: 'credentials_absent', ok: (i) => i.credentialsPresent === true },
  { blocker: 'webhook_domain_unverified', ok: (i) => i.webhookDomainVerified === true },
  { blocker: 'provider_review_not_approved', ok: (i) => i.providerAppReviewApproved === true },
  { blocker: 'paid_service_not_approved', ok: (i) => i.paidServiceApproved === true },
  { blocker: 'compliance_not_approved', ok: (i) => i.complianceApproved === true },
  { blocker: 'sandbox_smoke_not_passed', ok: (i) => i.sandboxSmokePassed === true },
  { blocker: 'no_named_approver', ok: (i) => Boolean(i.namedApprover && i.namedApprover.trim()) },
];

/**
 * Decide whether a provider may be activated live. Pure and deterministic.
 *
 * `allowed` is the AND of `operationalReady` (all operator prerequisites) and
 * `codePathImplemented` (the compile-time engineering key). Because the
 * engineering key is `false`, `allowed` is always `false` today — this is the
 * safety guarantee, not a bug.
 */
export function evaluateProviderActivation(
  inputs: ProviderActivationInputs,
): ProviderActivationDecision {
  const blockers: ActivationBlocker[] = [];

  // The engineering key is reported first when unmet — it is the outermost gate.
  // Typed as a widened boolean so the (currently constant-false) value can be
  // ANDed without a literal-comparison type error.
  const codePathImplemented: boolean = LIVE_PROVIDER_ACTIVATION_IMPLEMENTED;
  if (!codePathImplemented) blockers.push('engineering_not_implemented');

  for (const req of REQUIREMENTS) {
    if (!req.ok(inputs)) blockers.push(req.blocker);
  }

  const operationalReady = REQUIREMENTS.every((req) => req.ok(inputs));
  // ANDed with the constant — an operator can never override the engineering key.
  const allowed = operationalReady && codePathImplemented;

  const summary = allowed
    ? 'Activation permitted.'
    : !codePathImplemented
      ? 'Live provider adapters are not implemented yet (Phase 7B engineering PR pending); activation is impossible.'
      : `Activation blocked — ${blockers.length} operator prerequisite(s) unmet.`;

  return { allowed, operationalReady, codePathImplemented, blockers, summary };
}

/** Human-readable label for each blocker (for runbooks / UI). */
export const ACTIVATION_BLOCKER_LABELS: Record<ActivationBlocker, string> = {
  engineering_not_implemented: 'Real provider adapters not yet implemented (engineering)',
  profile_not_full: 'Deployment profile must be "full" (not controlled_mvp)',
  runtime_flag_off: 'INTEGRATION_LIVE_PROVIDERS_ENABLED is off',
  credentials_absent: 'Verified provider credentials are not present',
  webhook_domain_unverified: 'Inbound webhook domain is not verified with the provider',
  provider_review_not_approved: 'Provider app/business review is not approved',
  paid_service_not_approved: 'Paid-service usage is not approved',
  compliance_not_approved: 'Compliance / privacy / consent sign-off is missing',
  sandbox_smoke_not_passed: 'Sandbox/fixture smoke has not passed',
  no_named_approver: 'No named approver recorded',
};
