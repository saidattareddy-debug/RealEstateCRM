/**
 * Phase 8 — Notification routing (PURE, no IO).
 *
 * Decides, deterministically, which delivery channels a notification should use
 * given the recipient's preferences, the notification's priority, and quiet
 * hours. In-app delivery is always available (no external IO). Email/push are
 * routed as INTENTS only — actual external delivery is a Phase-7B/credential
 * concern and is simulated by the server; nothing here performs IO or sends.
 */

export const NOTIFICATION_KINDS = [
  'lead_assigned',
  'lead_hot',
  'conversation_waiting',
  'task_due',
  'task_overdue',
  'visit_scheduled',
  'visit_reminder',
  'visit_cancelled',
  'sla_breach',
  'automation_failed',
  'mention',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationChannel = 'in_app' | 'email' | 'push';

export interface NotificationPreferences {
  /** Channels the user opted into, per priority floor. */
  emailEnabled: boolean;
  pushEnabled: boolean;
  /** Respect quiet hours for non-urgent notifications. */
  quietHoursEnabled: boolean;
  /** Kinds the user muted entirely. */
  mutedKinds: NotificationKind[];
}

export interface NotificationInput {
  kind: NotificationKind;
  priority: NotificationPriority;
  recipientUserId: string;
  /** Stable key for de-duplication (same key within a window = one notification). */
  dedupeKey: string;
}

export interface NotificationRouting {
  /** Whether to create the notification at all. */
  deliver: boolean;
  channels: NotificationChannel[];
  suppressedReason: string | null;
  /** External channels are intents only; never delivered here. */
  externalSimulated: boolean;
}

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Route a notification to channels. In-app is always included when delivered.
 * Urgent notifications bypass quiet hours; muted kinds are dropped.
 */
export function routeNotification(
  input: NotificationInput,
  prefs: NotificationPreferences,
  inQuietHours: boolean,
): NotificationRouting {
  if (prefs.mutedKinds.includes(input.kind)) {
    return {
      deliver: false,
      channels: [],
      suppressedReason: 'kind_muted',
      externalSimulated: false,
    };
  }

  const isUrgent = input.priority === 'urgent';
  if (prefs.quietHoursEnabled && inQuietHours && !isUrgent) {
    // Defer external channels but still record in-app silently.
    return {
      deliver: true,
      channels: ['in_app'],
      suppressedReason: 'quiet_hours_external_deferred',
      externalSimulated: false,
    };
  }

  const channels: NotificationChannel[] = ['in_app'];
  const meetsHighBar = PRIORITY_RANK[input.priority] >= PRIORITY_RANK.high;
  if (prefs.emailEnabled && (meetsHighBar || isUrgent)) channels.push('email');
  if (prefs.pushEnabled) channels.push('push');

  const externalSimulated = channels.some((c) => c !== 'in_app');
  return { deliver: true, channels, suppressedReason: null, externalSimulated };
}

/** De-duplicate a batch by dedupeKey, keeping the highest-priority instance. */
export function dedupeNotifications(inputs: NotificationInput[]): NotificationInput[] {
  const byKey = new Map<string, NotificationInput>();
  for (const n of inputs) {
    const existing = byKey.get(n.dedupeKey);
    if (!existing || PRIORITY_RANK[n.priority] > PRIORITY_RANK[existing.priority]) {
      byKey.set(n.dedupeKey, n);
    }
  }
  return [...byKey.values()];
}
