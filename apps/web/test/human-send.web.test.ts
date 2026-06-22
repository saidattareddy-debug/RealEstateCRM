import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeAdmin, rowCount, type FakeDb } from './fake-supabase';

// Shared mutable fake DB the mocked admin client reads/writes.
const state: { db: FakeDb } = { db: { tables: {} } };
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => makeFakeAdmin(state.db).client,
}));
vi.mock('@/lib/audit/audit-service', () => ({ writeAudit: () => Promise.resolve() }));

import { simulateHumanSend } from '@/lib/integrations/human-send';

const base = {
  tenantId: 't1',
  actorUserId: 'u1',
  conversationId: 'c1',
  channel: 'whatsapp_cloud' as const,
  body: 'hello there',
  idempotencyKey: 'k1',
};

beforeEach(() => {
  state.db = { tables: {} };
});

describe('simulateHumanSend (Phase 7A — simulation only)', () => {
  it('empty body is blocked and writes no customer message', async () => {
    const res = await simulateHumanSend({ ...base, body: '   ' });
    expect(res.simulated).toBe(true);
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('empty_body');
    expect(rowCount(state.db, 'conversation_messages')).toBe(0);
  });

  it('unknown conversation is blocked, no message/delivery/provider reference', async () => {
    const res = await simulateHumanSend({ ...base });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('conversation_not_found');
    expect(res.preview).toBe('');
    expect(rowCount(state.db, 'conversation_messages')).toBe(0);
    expect(rowCount(state.db, 'message_delivery_events')).toBe(0);
  });

  it('closed conversation is blocked and never produces a customer-visible message', async () => {
    state.db.tables.conversations = [
      { id: 'c1', tenant_id: 't1', lead_id: 'l1', status: 'closed', lifecycle: 'closed' },
    ];
    const res = await simulateHumanSend({ ...base });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('conversation_closed');
    expect(rowCount(state.db, 'conversation_messages')).toBe(0);
  });
});
