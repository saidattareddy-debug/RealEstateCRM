import { describe, it, expect } from 'vitest';
import {
  LIVE_SEND_MASTER_SWITCH,
  evaluateLiveSendGates,
  summarizeLiveSendEvaluations,
  buildAutomaticSendIdempotencyKey,
  shouldCancelStaleCandidate,
  revalidateAutomaticSend,
  reconcileUncertainAttempt,
  createDryRunTransport,
  createFailureTransport,
  createTimeoutTransport,
  createSuccessSimTransport,
  type LiveSendGateInput,
  type AutomaticSendCandidate,
  type CandidateCurrentState,
} from '../ai-live-send';

const allFlagsOn = (over: Partial<LiveSendGateInput> = {}): LiveSendGateInput => ({
  masterSwitchOn: true,
  platformEnabled: true,
  tenantEnabled: true,
  channelEnabled: true,
  projectEnabled: true,
  operatingModeAi: true,
  humanTakeover: false,
  conversationOpen: true,
  consentAndDncAllowed: true,
  providerAvailable: true,
  usageWithinLimits: true,
  grounded: true,
  citationComplete: true,
  transportValid: true,
  workerRevalidationOk: true,
  ...over,
});

describe('global master switch', () => {
  it('is OFF in Phase 5B.0', () => {
    expect(LIVE_SEND_MASTER_SWITCH).toBe(false);
  });

  it('with EVERY db flag enabled, sending is still NOT allowed (db config cannot enable)', () => {
    const e = evaluateLiveSendGates(allFlagsOn());
    expect(e.allowed).toBe(false);
    expect(e.failedGates).toContain('global_master_switch_off');
    expect(e.suppressedReason).toBe('phase_5b1_live_send_master_switch_off');
  });

  it('a caller passing masterSwitchOn:true cannot override the compile-time false', () => {
    expect(evaluateLiveSendGates(allFlagsOn({ masterSwitchOn: true })).allowed).toBe(false);
  });

  it('summary reports zero delivered / safe across a full matrix', () => {
    const evals = [
      allFlagsOn(),
      allFlagsOn({ grounded: false }),
      allFlagsOn({ humanTakeover: true }),
      allFlagsOn({ tenantEnabled: false }),
      allFlagsOn({ channelEnabled: false }),
    ].map(evaluateLiveSendGates);
    const s = summarizeLiveSendEvaluations(evals);
    expect(s.delivered).toBe(0);
    expect(s.allowed).toBe(0);
    expect(s.safe).toBe(true);
  });

  it('every individual gate is reported when it fails', () => {
    expect(evaluateLiveSendGates(allFlagsOn({ platformEnabled: false })).failedGates).toContain(
      'platform_disabled',
    );
    expect(evaluateLiveSendGates(allFlagsOn({ grounded: false })).failedGates).toContain(
      'not_grounded',
    );
    expect(evaluateLiveSendGates(allFlagsOn({ citationComplete: false })).failedGates).toContain(
      'citation_incomplete',
    );
    expect(evaluateLiveSendGates(allFlagsOn({ transportValid: false })).failedGates).toContain(
      'transport_invalid',
    );
  });
});

describe('idempotency key', () => {
  const parts = {
    tenantId: 't1',
    conversationId: 'c1',
    triggeringInboundMessageId: 'm1',
    responderPolicyVersion: 'rp1',
    promptVersion: 'p1',
    modelConfigId: 'mc1',
    knowledgeSnapshotId: 'ks1',
    attemptType: 'auto_reply',
  };

  it('is deterministic for identical inputs', () => {
    expect(buildAutomaticSendIdempotencyKey(parts)).toBe(buildAutomaticSendIdempotencyKey(parts));
  });

  it('changes when any stable identifier changes', () => {
    const base = buildAutomaticSendIdempotencyKey(parts);
    expect(
      buildAutomaticSendIdempotencyKey({ ...parts, triggeringInboundMessageId: 'm2' }),
    ).not.toBe(base);
    expect(buildAutomaticSendIdempotencyKey({ ...parts, promptVersion: 'p2' })).not.toBe(base);
    expect(buildAutomaticSendIdempotencyKey({ ...parts, knowledgeSnapshotId: 'ks2' })).not.toBe(
      base,
    );
  });
});

const candidate = (over: Partial<AutomaticSendCandidate> = {}): AutomaticSendCandidate => ({
  id: 'cand1',
  tenantId: 't1',
  conversationId: 'c1',
  createdAt: '2026-06-20T00:00:00Z',
  expiresAt: '2026-06-20T01:00:00Z',
  triggeringInboundMessageId: 'm1',
  conversationStateVersion: 5,
  latestMessageIdAtCreation: 'm1',
  promptVersion: 'p1',
  knowledgeSnapshotId: 'ks1',
  groundingVersion: 'g1',
  ...over,
});

const freshState = (over: Partial<CandidateCurrentState> = {}): CandidateCurrentState => ({
  now: new Date('2026-06-20T00:30:00Z'),
  killSwitchActive: false,
  humanReplied: false,
  latestInboundMessageId: 'm1',
  humanTakeover: false,
  conversationClosed: false,
  consentChanged: false,
  dncActivated: false,
  knowledgeWithdrawn: false,
  inventoryStale: false,
  ...over,
});

describe('stale-candidate cancellation', () => {
  it('does not cancel a fresh, unchanged candidate', () => {
    expect(shouldCancelStaleCandidate(candidate(), freshState()).cancel).toBe(false);
  });

  it('cancels on expiry, kill switch, takeover, close, human reply, newer message, dnc, consent, knowledge, inventory', () => {
    const cases: [Partial<CandidateCurrentState>, string][] = [
      [{ now: new Date('2026-06-20T02:00:00Z') }, 'candidate_expired'],
      [{ killSwitchActive: true }, 'kill_switch_active'],
      [{ humanTakeover: true }, 'human_takeover'],
      [{ conversationClosed: true }, 'conversation_closed'],
      [{ humanReplied: true }, 'human_replied'],
      [{ latestInboundMessageId: 'm2' }, 'newer_customer_message'],
      [{ dncActivated: true }, 'dnc_activated'],
      [{ consentChanged: true }, 'consent_changed'],
      [{ knowledgeWithdrawn: true }, 'knowledge_withdrawn'],
      [{ inventoryStale: true }, 'inventory_stale'],
    ];
    for (const [state, reason] of cases) {
      const r = shouldCancelStaleCandidate(candidate(), freshState(state));
      expect(r.cancel).toBe(true);
      expect(r.reason).toBe(reason);
    }
  });
});

describe('worker-time revalidation', () => {
  it('NEVER proceeds even with all flags on and a fresh candidate (master off)', () => {
    const r = revalidateAutomaticSend(candidate(), {
      gateInput: allFlagsOn(),
      currentState: freshState(),
    });
    expect(r.proceed).toBe(false);
    expect(r.suppressedReason).toBe('phase_5b1_live_send_master_switch_off');
  });

  it('reports cancellation when the conversation moved on', () => {
    const r = revalidateAutomaticSend(candidate(), {
      gateInput: allFlagsOn(),
      currentState: freshState({ humanReplied: true }),
    });
    expect(r.proceed).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.cancellationReason).toBe('human_replied');
  });
});

describe('delivery transports (simulation only)', () => {
  const req = {
    idempotencyKey: 'k1',
    channel: 'website_chat' as const,
    conversationId: 'c1',
    body: 'hello',
    correlationId: 'corr1',
  };
  const ctx = { now: new Date('2026-06-20T00:30:00Z'), dryRun: true };

  it('dry-run never delivers (simulated, no provider ref)', async () => {
    const r = await createDryRunTransport('website_chat').send(req, ctx);
    expect(r.simulated).toBe(true);
    expect(r.status).toBe('simulated');
    expect(r.providerMessageRef).toBeNull();
  });

  it('failure transport is retryable with a safe error code, simulated', async () => {
    const r = await createFailureTransport('website_chat').send(req, ctx);
    expect(r.status).toBe('failed');
    expect(r.retryable).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.errorCode).toBe('provider_error:simulated');
  });

  it('timeout transport is the uncertain case, still simulated', async () => {
    const r = await createTimeoutTransport('website_chat').send(req, ctx);
    expect(r.status).toBe('timeout');
    expect(r.retryable).toBe(true);
    expect(r.simulated).toBe(true);
  });

  it('success SIMULATION sets a provider ref but stays simulated (no real send)', async () => {
    const r = await createSuccessSimTransport('website_chat').send(req, ctx);
    expect(r.simulated).toBe(true);
    expect(r.providerMessageRef).toBe('sim-k1');
    expect(r.acceptedAt).not.toBeNull();
  });
});

describe('external-success reconciliation', () => {
  it('never resends an uncertain timeout — routes to manual review', () => {
    const r = reconcileUncertainAttempt({
      idempotencyKey: 'k1',
      priorStatus: 'timeout',
      providerMessageRef: null,
    });
    expect(r.resend).toBe(false);
    expect(r.resolution).toBe('manual_review');
  });

  it('a known provider ref confirms acceptance (do not resend)', () => {
    const r = reconcileUncertainAttempt({
      idempotencyKey: 'k1',
      priorStatus: 'timeout',
      providerMessageRef: 'sim-k1',
    });
    expect(r.resolution).toBe('confirmed_simulated');
    expect(r.resend).toBe(false);
  });

  it('a clean failure is not-sent (no resend here; the queue handles retry)', () => {
    const r = reconcileUncertainAttempt({
      idempotencyKey: 'k1',
      priorStatus: 'failed',
      providerMessageRef: null,
    });
    expect(r.resolution).toBe('not_sent');
    expect(r.resend).toBe(false);
  });
});
