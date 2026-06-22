import { describe, it, expect } from 'vitest';
import {
  buildDeterministicSummary,
  isContactable,
  needsResponse,
  type ConvMessage,
} from '../conversation';

const msg = (
  direction: ConvMessage['direction'],
  body: string,
  createdAt: string,
  sender: ConvMessage['sender'] = direction === 'inbound' ? 'lead' : 'agent',
): ConvMessage => ({ direction, sender, body, createdAt });

describe('buildDeterministicSummary', () => {
  it('flags an unanswered inbound question', () => {
    const r = buildDeterministicSummary([
      msg('outbound', 'Hello! How can I help?', '2026-06-19T10:00:00Z'),
      msg('inbound', 'Is the 2BHK still available?', '2026-06-19T10:01:00Z'),
    ]);
    expect(r.messageCount).toBe(2);
    expect(r.unansweredQuestion).toBe('Is the 2BHK still available?');
    expect(r.recommendedNextAction).toMatch(/open question/i);
  });

  it('does not flag a question that was answered after', () => {
    const r = buildDeterministicSummary([
      msg('inbound', 'Price?', '2026-06-19T10:00:00Z'),
      msg('outbound', 'It is 95L.', '2026-06-19T10:01:00Z'),
    ]);
    expect(r.unansweredQuestion).toBeNull();
    expect(r.recommendedNextAction).toMatch(/awaiting the lead/i);
  });

  it('handles an empty log', () => {
    const r = buildDeterministicSummary([]);
    expect(r.messageCount).toBe(0);
    expect(r.summary).toBe('No messages yet.');
  });
});

describe('isContactable (DNC)', () => {
  it('blocks when do_not_contact is set for the channel', () => {
    const d = isContactable([{ channel: 'whatsapp', status: 'do_not_contact' }], 'whatsapp');
    expect(d.contactable).toBe(false);
    expect(d.reason).toMatch(/do-not-contact/i);
  });

  it('blocks when a global (any) consent is revoked', () => {
    const d = isContactable([{ channel: 'any', status: 'revoked' }], 'email');
    expect(d.contactable).toBe(false);
  });

  it('allows when only an unrelated channel is blocked', () => {
    const d = isContactable([{ channel: 'call', status: 'do_not_contact' }], 'whatsapp');
    expect(d.contactable).toBe(true);
  });

  it('allows when there is no record', () => {
    expect(isContactable([], 'sms').contactable).toBe(true);
  });
});

describe('needsResponse', () => {
  const now = new Date('2026-06-19T10:30:00Z');

  it('is true and overdue when the lead is waiting past SLA', () => {
    const r = needsResponse(
      {
        status: 'open',
        lastInboundAt: '2026-06-19T10:00:00Z',
        lastMessageAt: '2026-06-19T10:00:00Z',
      },
      now,
      15,
    );
    expect(r.needsResponse).toBe(true);
    expect(r.overdue).toBe(true);
    expect(r.waitingMinutes).toBe(30);
  });

  it('is false when an outbound reply followed', () => {
    const r = needsResponse(
      {
        status: 'open',
        lastInboundAt: '2026-06-19T10:00:00Z',
        lastMessageAt: '2026-06-19T10:05:00Z',
      },
      now,
    );
    expect(r.needsResponse).toBe(false);
  });

  it('is false when closed', () => {
    const r = needsResponse(
      {
        status: 'closed',
        lastInboundAt: '2026-06-19T10:00:00Z',
        lastMessageAt: '2026-06-19T10:00:00Z',
      },
      now,
    );
    expect(r.needsResponse).toBe(false);
  });
});
