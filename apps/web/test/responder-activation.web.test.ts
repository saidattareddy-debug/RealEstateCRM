import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeAdmin, type FakeDb } from './fake-supabase';

// Audit is a side effect we don't exercise here.
vi.mock('@/lib/audit/audit-service', () => ({ writeAudit: () => Promise.resolve() }));

import {
  createActivationRequest,
  recordActivationApproval,
  applyApprovedActivation,
  getActivationState,
  setKillSwitch,
} from '@/lib/responder/activation';

/**
 * Phase 5B.1 activation service (apps/web). Proves the two-person governance
 * behaviour AND the headline safety fact: even a fully-approved request never
 * yields a sendable mode or `liveSendingPermitted` — the master switch is off.
 * The runtime no-external-IO trap (setup.web.ts) is also in force.
 */

let db: FakeDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;

function seedSettings(over: Record<string, unknown> = {}) {
  db.tables.responder_channel_settings = [
    {
      id: 'cs1',
      tenant_id: 't1',
      channel: 'website_chat',
      project_id: null,
      mode: 'disabled',
      kill_switch_active: false,
      rollout_percentage: 0,
      effective_start: null,
      effective_expiry: null,
      ...over,
    },
  ];
}

function seedApprovedRequest() {
  db.tables.responder_activation_requests = [
    {
      id: 'rq1',
      tenant_id: 't1',
      channel: 'website_chat',
      project_id: null,
      requested_mode: 'live_candidate',
      requested_by: 'req-user',
      status: 'pending',
      summary: 'go live',
      created_at: '2026-06-22T00:00:00Z',
    },
  ];
  db.tables.responder_activation_approvals = [
    {
      id: 'a1',
      tenant_id: 't1',
      request_id: 'rq1',
      approval_role: 'product',
      approver_id: 'pm',
      decision: 'approve',
    },
    {
      id: 'a2',
      tenant_id: 't1',
      request_id: 'rq1',
      approval_role: 'engineering',
      approver_id: 'eng',
      decision: 'approve',
    },
    {
      id: 'a3',
      tenant_id: 't1',
      request_id: 'rq1',
      approval_role: 'legal',
      approver_id: 'legal',
      decision: 'approve',
    },
  ];
}

beforeEach(() => {
  db = { tables: {} };
  seedSettings();
  supabase = makeFakeAdmin(db).client;
});

describe('createActivationRequest', () => {
  it('creates a pending request for a requestable mode', async () => {
    const res = await createActivationRequest(supabase, {
      tenantId: 't1',
      actorUserId: 'req-user',
      channel: 'website_chat',
      requestedMode: 'live_candidate',
      summary: 'staging go-live',
    });
    expect(res.ok).toBe(true);
    expect((db.tables.responder_activation_requests ?? []).length).toBe(1);
  });

  it('refuses a non-requestable / sendable mode', async () => {
    const res = await createActivationRequest(supabase, {
      tenantId: 't1',
      actorUserId: 'req-user',
      channel: 'website_chat',
      // 'live' is a hypothetical sendable mode; must be refused.
      requestedMode: 'live' as never,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_requested_mode');
    expect((db.tables.responder_activation_requests ?? []).length).toBe(0);
  });
});

describe('applyApprovedActivation', () => {
  it('refuses while approvals are incomplete', async () => {
    seedApprovedRequest();
    db.tables.responder_activation_approvals = (
      db.tables.responder_activation_approvals ?? []
    ).slice(0, 2);
    const res = await applyApprovedActivation(supabase, {
      tenantId: 't1',
      actorUserId: 'applier',
      requestId: 'rq1',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('approvals_incomplete');
    expect(db.tables.responder_channel_settings?.[0]?.mode).toBe('disabled');
  });

  it('applies live_candidate when fully approved — never a sendable mode', async () => {
    seedApprovedRequest();
    const res = await applyApprovedActivation(supabase, {
      tenantId: 't1',
      actorUserId: 'applier',
      requestId: 'rq1',
    });
    expect(res.ok).toBe(true);
    expect(res.appliedMode).toBe('live_candidate');
    const mode = db.tables.responder_channel_settings?.[0]?.mode;
    expect(mode).toBe('live_candidate');
    expect(mode).not.toBe('live'); // never a customer-sending mode
    expect(db.tables.responder_activation_requests?.[0]?.status).toBe('approved');
  });
});

describe('getActivationState — never permits live sending', () => {
  it('a fully-approved, rollout-configured request is operatorReady but NOT permitted', async () => {
    seedSettings({ rollout_percentage: 10, effective_start: '2026-01-01T00:00:00Z' });
    seedApprovedRequest();
    const state = await getActivationState(supabase, 't1', 'website_chat', null);
    expect(state.decision.operatorReady).toBe(true);
    expect(state.decision.liveSendingPermitted).toBe(false);
    expect(state.decision.masterSwitchOn).toBe(false);
    expect(state.pendingRequest?.approvals.length).toBe(3);
  });

  it('reports no pending request and disabled mode by default', async () => {
    const state = await getActivationState(supabase, 't1', 'website_chat', null);
    expect(state.currentMode).toBe('disabled');
    expect(state.pendingRequest).toBeNull();
    expect(state.decision.liveSendingPermitted).toBe(false);
  });
});

describe('recordActivationApproval + setKillSwitch', () => {
  it('records an approval row', async () => {
    seedApprovedRequest();
    db.tables.responder_activation_approvals = [];
    const res = await recordActivationApproval(supabase, {
      tenantId: 't1',
      actorUserId: 'pm',
      requestId: 'rq1',
      role: 'product',
      decision: 'approve',
    });
    expect(res.ok).toBe(true);
    expect((db.tables.responder_activation_approvals ?? []).length).toBe(1);
  });

  it('toggles the kill switch', async () => {
    const res = await setKillSwitch(supabase, {
      tenantId: 't1',
      actorUserId: 'op',
      channel: 'website_chat',
      projectId: null,
      active: true,
      reason: 'incident',
    });
    expect(res.ok).toBe(true);
    expect(db.tables.responder_channel_settings?.[0]?.kill_switch_active).toBe(true);
  });
});
