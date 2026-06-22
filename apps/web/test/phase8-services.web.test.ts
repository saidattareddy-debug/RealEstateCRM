import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeAdmin, type FakeDb } from './fake-supabase';

vi.mock('@/lib/audit/audit-service', () => ({ writeAudit: () => Promise.resolve() }));

import { scheduleVisit } from '@/lib/visits/service';
import { createNotification } from '@/lib/notifications/service';

/**
 * Phase 8 service safety + behaviour (apps/web). Proves double-booking is
 * prevented (visits) and that external notification deliveries are recorded as
 * SIMULATED (never really sent). The runtime no-external-IO trap is in force.
 */

let db: FakeDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;

beforeEach(() => {
  db = { tables: {} };
  supabase = makeFakeAdmin(db).client;
});

describe('scheduleVisit — double-booking prevention', () => {
  function seedExistingVisit() {
    db.tables.site_visits = [
      {
        id: 'v-existing',
        tenant_id: 't1',
        agent_id: 'agent1',
        scheduled_start: '2026-06-23T10:00:00Z',
        scheduled_end: '2026-06-23T11:00:00Z',
        state: 'scheduled',
      },
    ];
  }

  it('rejects an overlapping window for the same agent', async () => {
    seedExistingVisit();
    const res = await scheduleVisit(supabase, {
      tenantId: 't1',
      actorUserId: 'u1',
      leadId: 'lead1',
      agentId: 'agent1',
      scheduledStart: '2026-06-23T10:30:00Z',
      scheduledEnd: '2026-06-23T11:30:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('double_booking');
    expect(res.conflict).toBe(true);
    // No new visit row was written.
    expect((db.tables.site_visits ?? []).length).toBe(1);
  });

  it('allows a non-overlapping window', async () => {
    seedExistingVisit();
    const res = await scheduleVisit(supabase, {
      tenantId: 't1',
      actorUserId: 'u1',
      leadId: 'lead1',
      agentId: 'agent1',
      scheduledStart: '2026-06-23T11:00:00Z', // touches edge — not an overlap
      scheduledEnd: '2026-06-23T12:00:00Z',
    });
    expect(res.ok).toBe(true);
    expect((db.tables.site_visits ?? []).length).toBe(2);
  });
});

describe('createNotification — external deliveries are simulated', () => {
  it('records an external (email) delivery as simulated, never really sent', async () => {
    db.tables.notification_preferences = [
      {
        id: 'p1',
        tenant_id: 't1',
        user_id: 'u1',
        email_enabled: true,
        push_enabled: false,
        quiet_hours_enabled: false,
        muted_kinds: [],
      },
    ];
    const res = await createNotification(supabase, {
      tenantId: 't1',
      recipientUserId: 'u1',
      kind: 'lead_hot',
      priority: 'urgent',
      title: 'Hot lead',
      now: new Date('2026-06-23T06:00:00Z'),
    });
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(true);
    expect(res.channels).toContain('email');
    const deliveries = db.tables.notification_deliveries ?? [];
    const email = deliveries.find((d) => d.channel === 'email');
    expect(email).toBeTruthy();
    expect(email?.simulated).toBe(true); // never a real external send
    const inApp = deliveries.find((d) => d.channel === 'in_app');
    expect(inApp?.simulated).toBe(false);
  });

  it('drops a muted kind without creating a notification', async () => {
    db.tables.notification_preferences = [
      {
        id: 'p1',
        tenant_id: 't1',
        user_id: 'u1',
        email_enabled: true,
        push_enabled: true,
        quiet_hours_enabled: false,
        muted_kinds: ['lead_hot'],
      },
    ];
    const res = await createNotification(supabase, {
      tenantId: 't1',
      recipientUserId: 'u1',
      kind: 'lead_hot',
      priority: 'high',
      title: 'Hot lead',
    });
    expect(res.delivered).toBe(false);
    expect((db.tables.notifications ?? []).length).toBe(0);
  });
});
