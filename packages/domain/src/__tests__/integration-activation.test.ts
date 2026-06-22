import { describe, it, expect } from 'vitest';
import {
  evaluateProviderActivation,
  LIVE_PROVIDER_ACTIVATION_IMPLEMENTED,
  ACTIVATION_BLOCKER_LABELS,
  type ProviderActivationInputs,
  type ActivationBlocker,
} from '../integration-activation';

/** Every operator prerequisite satisfied — the "best case" an operator can reach. */
const fullyReady: ProviderActivationInputs = {
  deploymentProfile: 'full',
  runtimeFlagEnabled: true,
  credentialsPresent: true,
  webhookDomainVerified: true,
  providerAppReviewApproved: true,
  paidServiceApproved: true,
  complianceApproved: true,
  sandboxSmokePassed: true,
  namedApprover: 'jane.operator',
};

const BOOLEAN_KEYS: (keyof ProviderActivationInputs)[] = [
  'runtimeFlagEnabled',
  'credentialsPresent',
  'webhookDomainVerified',
  'providerAppReviewApproved',
  'paidServiceApproved',
  'complianceApproved',
  'sandboxSmokePassed',
];

describe('LIVE_PROVIDER_ACTIVATION_IMPLEMENTED', () => {
  it('is a compile-time false (engineering key)', () => {
    expect(LIVE_PROVIDER_ACTIVATION_IMPLEMENTED).toBe(false);
  });
});

describe('evaluateProviderActivation — headline safety invariant', () => {
  it('NEVER allows activation, even when every operator prerequisite is satisfied', () => {
    const d = evaluateProviderActivation(fullyReady);
    expect(d.allowed).toBe(false);
    expect(d.operationalReady).toBe(true); // operator side can be fully ready…
    expect(d.codePathImplemented).toBe(false); // …but the engineering key is off
    expect(d.blockers).toContain('engineering_not_implemented');
    expect(d.summary).toMatch(/not implemented/i);
  });

  it('never allows activation across an exhaustive matrix of operator inputs', () => {
    const bools = [true, false];
    let checked = 0;
    for (const profile of ['controlled_mvp', 'full'] as const) {
      for (const flag of bools)
        for (const creds of bools)
          for (const domain of bools)
            for (const review of bools)
              for (const paid of bools)
                for (const compliance of bools)
                  for (const smoke of bools)
                    for (const approver of ['', 'someone']) {
                      const d = evaluateProviderActivation({
                        deploymentProfile: profile,
                        runtimeFlagEnabled: flag,
                        credentialsPresent: creds,
                        webhookDomainVerified: domain,
                        providerAppReviewApproved: review,
                        paidServiceApproved: paid,
                        complianceApproved: compliance,
                        sandboxSmokePassed: smoke,
                        namedApprover: approver,
                      });
                      expect(d.allowed).toBe(false);
                      expect(d.codePathImplemented).toBe(false);
                      expect(d.blockers).toContain('engineering_not_implemented');
                      checked++;
                    }
    }
    // 2 profiles × 2^7 booleans × 2 approver = 512 combinations.
    expect(checked).toBe(512);
  });
});

describe('evaluateProviderActivation — operator prerequisite tracking', () => {
  it('controlled_mvp is always operationally not-ready (profile blocker)', () => {
    const d = evaluateProviderActivation({ ...fullyReady, deploymentProfile: 'controlled_mvp' });
    expect(d.operationalReady).toBe(false);
    expect(d.blockers).toContain('profile_not_full');
  });

  it('reports the runtime flag off as a blocker', () => {
    const d = evaluateProviderActivation({ ...fullyReady, runtimeFlagEnabled: false });
    expect(d.operationalReady).toBe(false);
    expect(d.blockers).toContain('runtime_flag_off');
  });

  it('a blank named approver counts as missing', () => {
    const d = evaluateProviderActivation({ ...fullyReady, namedApprover: '   ' });
    expect(d.blockers).toContain('no_named_approver');
    const d2 = evaluateProviderActivation({ ...fullyReady, namedApprover: null });
    expect(d2.blockers).toContain('no_named_approver');
  });

  it('each operator prerequisite, when unset alone, surfaces exactly its own blocker', () => {
    for (const key of BOOLEAN_KEYS) {
      const d = evaluateProviderActivation({ ...fullyReady, [key]: false });
      // operationalReady false; engineering blocker always present; plus this one.
      expect(d.operationalReady).toBe(false);
      const operatorBlockers = d.blockers.filter(
        (b): b is ActivationBlocker => b !== 'engineering_not_implemented',
      );
      expect(operatorBlockers.length).toBe(1);
    }
  });

  it('a fully-unready controlled_mvp input lists all blockers', () => {
    const d = evaluateProviderActivation({
      deploymentProfile: 'controlled_mvp',
      runtimeFlagEnabled: false,
      credentialsPresent: false,
      webhookDomainVerified: false,
      providerAppReviewApproved: false,
      paidServiceApproved: false,
      complianceApproved: false,
      sandboxSmokePassed: false,
      namedApprover: null,
    });
    // 1 engineering + 9 operator prerequisites.
    expect(d.blockers.length).toBe(10);
    expect(new Set(d.blockers).size).toBe(10);
  });
});

describe('ACTIVATION_BLOCKER_LABELS', () => {
  it('has a label for every blocker the engine can emit', () => {
    const all: ActivationBlocker[] = [
      'engineering_not_implemented',
      'profile_not_full',
      'runtime_flag_off',
      'credentials_absent',
      'webhook_domain_unverified',
      'provider_review_not_approved',
      'paid_service_not_approved',
      'compliance_not_approved',
      'sandbox_smoke_not_passed',
      'no_named_approver',
    ];
    for (const b of all) expect(ACTIVATION_BLOCKER_LABELS[b]).toBeTruthy();
  });
});
