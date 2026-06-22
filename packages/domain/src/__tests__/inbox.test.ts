import { describe, it, expect } from 'vitest';
import {
  computeWaitingOn,
  validateDeliveryTransition,
  resolveCannedReply,
  computeSlaStatus,
  buildSnippet,
  deriveUnread,
  detectOwnerMismatch,
  type WaitingMessage,
  type UnreadMessage,
} from '../inbox';

const m = (
  direction: WaitingMessage['direction'],
  sender: WaitingMessage['sender'],
  failed = false,
): WaitingMessage => ({ direction, sender, failed });

describe('computeWaitingOn', () => {
  it('new inbound → waiting on agent', () => {
    expect(computeWaitingOn('open', [m('inbound', 'lead')])).toBe('agent');
  });
  it('agent response → waiting on lead', () => {
    expect(computeWaitingOn('open', [m('inbound', 'lead'), m('outbound', 'agent')])).toBe('lead');
  });
  it('internal note does not change waiting state', () => {
    expect(computeWaitingOn('open', [m('inbound', 'lead'), m('internal', 'agent')])).toBe('agent');
  });
  it('failed outbound still owes the lead a reply', () => {
    expect(computeWaitingOn('open', [m('inbound', 'lead'), m('outbound', 'agent', true)])).toBe(
      'agent',
    );
  });
  it('system message → waiting on system', () => {
    expect(computeWaitingOn('open', [m('outbound', 'system')])).toBe('system');
  });
  it('closed/resolved → none', () => {
    expect(computeWaitingOn('closed', [m('inbound', 'lead')])).toBe('none');
    expect(computeWaitingOn('resolved', [m('inbound', 'lead')])).toBe('none');
  });
});

describe('validateDeliveryTransition', () => {
  it('allows the normal outbound path', () => {
    expect(validateDeliveryTransition('queued', 'sent')).toBe(true);
    expect(validateDeliveryTransition('sent', 'delivered')).toBe(true);
    expect(validateDeliveryTransition('delivered', 'read')).toBe(true);
  });
  it('rejects impossible jumps', () => {
    expect(validateDeliveryTransition('received', 'read')).toBe(false);
    expect(validateDeliveryTransition('queued', 'delivered')).toBe(false);
    expect(validateDeliveryTransition('read', 'sent')).toBe(false);
    expect(validateDeliveryTransition('sent', 'sent')).toBe(false);
  });
  it('allows retry from failed', () => {
    expect(validateDeliveryTransition('failed', 'queued')).toBe(true);
  });
});

describe('resolveCannedReply', () => {
  it('substitutes known variables only', () => {
    const r = resolveCannedReply('Hi {{lead_name}}, I am {{agent_name}}.', {
      lead_name: 'Asha',
      agent_name: 'Ravi',
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Hi Asha, I am Ravi.');
  });
  it('rejects unknown variables (never echoes them)', () => {
    const r = resolveCannedReply('Pay to {{bank_account}}', {});
    expect(r.ok).toBe(false);
    expect(r.unknownVariables).toContain('bank_account');
    expect(r.text).toBeNull();
  });
  it('does not evaluate HTML/JS — treats body as plain text', () => {
    const r = resolveCannedReply('<b>{{project_name}}</b>', { project_name: 'Skyline' });
    expect(r.text).toBe('<b>Skyline</b>'); // not parsed, just substituted
  });
  it('missing value for a known variable substitutes empty', () => {
    const r = resolveCannedReply('Call {{contact_number}}', {});
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Call ');
  });
});

describe('deriveUnread', () => {
  const msg = (
    id: string,
    direction: UnreadMessage['direction'],
    sender: UnreadMessage['sender'],
    createdAt: string,
  ): UnreadMessage => ({ id, direction, sender, createdAt });
  const ms: UnreadMessage[] = [
    msg('a', 'inbound', 'lead', '2026-06-19T10:00:00Z'),
    msg('b', 'outbound', 'agent', '2026-06-19T10:01:00Z'),
    msg('c', 'internal', 'agent', '2026-06-19T10:02:00Z'),
    msg('d', 'inbound', 'lead', '2026-06-19T10:03:00Z'),
    msg('e', 'outbound', 'system', '2026-06-19T10:04:00Z'),
  ];
  it('counts only customer inbound after last-read', () => {
    expect(deriveUnread(ms, '2026-06-19T10:01:30Z')).toBe(1); // only d
  });
  it('counts all inbound when never read', () => {
    expect(deriveUnread(ms, null)).toBe(2); // a + d (internal/system excluded)
  });
  it('zero once everything is read', () => {
    expect(deriveUnread(ms, '2026-06-19T11:00:00Z')).toBe(0);
  });
});

describe('detectOwnerMismatch', () => {
  it('flags differing owners, never auto-resolves', () => {
    expect(detectOwnerMismatch('ag1', 'ag2').mismatch).toBe(true);
    expect(detectOwnerMismatch('ag1', 'ag1').mismatch).toBe(false);
    expect(detectOwnerMismatch(null, 'ag2').mismatch).toBe(false);
  });
});

describe('buildSnippet', () => {
  it('centres a plain-text window on the match with offsets', () => {
    const s = buildSnippet('The 2BHK in Skyline is available now', 'skyline');
    expect(s.text).toContain('Skyline');
    expect(s.text.slice(s.matchStart, s.matchEnd).toLowerCase()).toBe('skyline');
  });
  it('returns plain text (no markup injected)', () => {
    const s = buildSnippet('<script>alert(1)</script> hello', 'hello');
    expect(s.text).not.toContain('<mark>');
    expect(s.text).toContain('hello');
  });
  it('handles no match gracefully', () => {
    const s = buildSnippet('nothing here', 'zzz');
    expect(s.matchStart).toBe(0);
    expect(s.matchEnd).toBe(0);
  });
});

describe('computeSlaStatus', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  it('breached when past due and unanswered', () => {
    expect(
      computeSlaStatus({
        dueAt: '2026-06-19T11:00:00Z',
        firstResponseAt: null,
        lifecycle: 'open',
        waitingOn: 'agent',
        now,
      }),
    ).toBe('breached');
  });
  it('paused while waiting on the lead', () => {
    expect(
      computeSlaStatus({
        dueAt: '2026-06-19T11:00:00Z',
        firstResponseAt: null,
        lifecycle: 'open',
        waitingOn: 'lead',
        now,
      }),
    ).toBe('paused');
  });
  it('on track once a first response exists', () => {
    expect(
      computeSlaStatus({
        dueAt: '2026-06-19T11:00:00Z',
        firstResponseAt: '2026-06-19T10:30:00Z',
        lifecycle: 'open',
        waitingOn: 'agent',
        now,
      }),
    ).toBe('on_track');
  });
  it('due soon within the window', () => {
    expect(
      computeSlaStatus({
        dueAt: '2026-06-19T12:03:00Z',
        firstResponseAt: null,
        lifecycle: 'open',
        waitingOn: 'agent',
        now,
        dueSoonMinutes: 5,
      }),
    ).toBe('due_soon');
  });
});
