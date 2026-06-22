import { describe, it, expect } from 'vitest';
import {
  routeNotification,
  dedupeNotifications,
  type NotificationInput,
  type NotificationPreferences,
} from '../notifications';

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  emailEnabled: true,
  pushEnabled: true,
  quietHoursEnabled: true,
  mutedKinds: [],
  ...over,
});

const input = (over: Partial<NotificationInput> = {}): NotificationInput => ({
  kind: 'lead_hot',
  priority: 'high',
  recipientUserId: 'u1',
  dedupeKey: 'lead_hot:l1',
  ...over,
});

describe('routeNotification', () => {
  it('always includes in_app when delivered', () => {
    const r = routeNotification(input({ priority: 'low' }), prefs(), false);
    expect(r.deliver).toBe(true);
    expect(r.channels).toContain('in_app');
  });

  it('drops muted kinds', () => {
    const r = routeNotification(input(), prefs({ mutedKinds: ['lead_hot'] }), false);
    expect(r.deliver).toBe(false);
    expect(r.suppressedReason).toBe('kind_muted');
  });

  it('adds email only for high/urgent', () => {
    expect(routeNotification(input({ priority: 'normal' }), prefs(), false).channels).not.toContain(
      'email',
    );
    expect(routeNotification(input({ priority: 'high' }), prefs(), false).channels).toContain(
      'email',
    );
  });

  it('quiet hours defers external channels for non-urgent (in_app only)', () => {
    const r = routeNotification(input({ priority: 'high' }), prefs(), true);
    expect(r.channels).toEqual(['in_app']);
    expect(r.suppressedReason).toBe('quiet_hours_external_deferred');
  });

  it('urgent bypasses quiet hours', () => {
    const r = routeNotification(input({ priority: 'urgent' }), prefs(), true);
    expect(r.channels).toContain('email');
    expect(r.suppressedReason).toBeNull();
  });

  it('external channels are marked simulated (never delivered here)', () => {
    const r = routeNotification(input({ priority: 'urgent' }), prefs(), false);
    expect(r.externalSimulated).toBe(true);
  });
});

describe('dedupeNotifications', () => {
  it('keeps the highest-priority instance per key', () => {
    const out = dedupeNotifications([
      input({ dedupeKey: 'k1', priority: 'low' }),
      input({ dedupeKey: 'k1', priority: 'urgent' }),
      input({ dedupeKey: 'k2', priority: 'normal' }),
    ]);
    expect(out).toHaveLength(2);
    const k1 = out.find((n) => n.dedupeKey === 'k1');
    expect(k1?.priority).toBe('urgent');
  });
});
