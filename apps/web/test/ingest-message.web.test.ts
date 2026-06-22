import { describe, it, expect, vi, beforeEach } from 'vitest';

// recomputeSlaAdmin touches many server modules; stub it and count calls.
const slaCalls: unknown[] = [];
vi.mock('@/app/(app)/inbox/sla', () => ({
  recomputeSlaAdmin: (...args: unknown[]) => {
    slaCalls.push(args);
    return Promise.resolve();
  },
}));

import { ingestConversationMessage } from '@/lib/conversations/ingest-message';
import { makeFakeAdmin, rowCount } from './fake-supabase';

const base = {
  tenantId: 't1',
  conversationId: 'c1',
  leadId: 'l1',
  body: 'hello',
  payloadHash: 'h1',
  correlationId: 'r1',
};

beforeEach(() => {
  slaCalls.length = 0;
});

describe('ingestConversationMessage (canonical, server)', () => {
  it('new message → exactly one ingestion event, attempt, message, and one SLA recompute', async () => {
    const { client, db } = makeFakeAdmin();
    const res = await ingestConversationMessage(
      { ...base, idempotencyKey: 'k1', externalMessageId: 'wamid.1' },
      client,
    );
    expect(res.ok).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.messageId).toBeTruthy();
    expect(rowCount(db, 'message_ingestion_events')).toBe(1);
    expect(rowCount(db, 'message_processing_attempts')).toBe(1);
    expect(rowCount(db, 'conversation_messages')).toBe(1);
    expect(slaCalls).toHaveLength(1);
  });

  it('duplicate authenticated message (same idempotency key) → returns existing, no new downstream effect', async () => {
    const { client, db } = makeFakeAdmin();
    await ingestConversationMessage(
      { ...base, idempotencyKey: 'k1', externalMessageId: 'wamid.1' },
      client,
    );
    slaCalls.length = 0;
    const dup = await ingestConversationMessage(
      { ...base, idempotencyKey: 'k1', externalMessageId: 'wamid.1' },
      client,
    );
    expect(dup.ok).toBe(true);
    expect(dup.duplicate).toBe(true);
    expect(rowCount(db, 'conversation_messages')).toBe(1); // no second message
    expect(rowCount(db, 'message_ingestion_events')).toBe(1);
    expect(slaCalls).toHaveLength(0); // no repeated downstream effect
  });

  it('same external message id under a new idempotency key → message insert is an idempotent no-op', async () => {
    const { client, db } = makeFakeAdmin();
    await ingestConversationMessage(
      { ...base, idempotencyKey: 'k1', externalMessageId: 'wamid.1' },
      client,
    );
    const again = await ingestConversationMessage(
      { ...base, idempotencyKey: 'k2', externalMessageId: 'wamid.1' },
      client,
    );
    expect(again.ok).toBe(true);
    expect(rowCount(db, 'conversation_messages')).toBe(1); // unique external_message_id holds
  });

  it('two distinct messages → two rows', async () => {
    const { client, db } = makeFakeAdmin();
    await ingestConversationMessage(
      { ...base, idempotencyKey: 'k1', externalMessageId: 'wamid.1' },
      client,
    );
    await ingestConversationMessage(
      { ...base, idempotencyKey: 'k2', externalMessageId: 'wamid.2', body: 'world' },
      client,
    );
    expect(rowCount(db, 'conversation_messages')).toBe(2);
  });
});
