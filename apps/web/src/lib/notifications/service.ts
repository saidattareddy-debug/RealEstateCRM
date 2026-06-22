import 'server-only';
import {
  routeNotification,
  dedupeNotifications,
  isQuietHours,
  NOTIFICATION_KINDS,
  type NotificationInput,
  type NotificationPreferences,
  type NotificationKind,
  type NotificationPriority,
} from '@re/domain';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

/**
 * Phase 8 — Notifications SERVICE (server-only).
 *
 * Creates notifications via the PURE `routeNotification` engine, records
 * `notification_deliveries` (external channels SIMULATED, `simulated = true`),
 * lists a user's own notifications and marks them read, and manages per-user
 * preferences. No external IO is ever performed (no live email/push provider) —
 * external deliveries are recorded as simulated intents only. The DB CHECK
 * enforces `channel='in_app' OR simulated=true`.
 */

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ServiceResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const DEFAULT_PREFS: NotificationPreferences = {
  emailEnabled: false,
  pushEnabled: false,
  quietHoursEnabled: true,
  mutedKinds: [],
};

/** List a user's own notifications (RLS already scopes to recipient). */
export async function listNotifications(
  supabase: DB,
  tenantId: string,
  userId: string,
  limit = 50,
): Promise<NotificationView[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, priority, title, body, entity_type, entity_id, read_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    priority: r.priority as NotificationPriority,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    readAt: (r.read_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Count a user's unread notifications. */
export async function countUnread(supabase: DB, tenantId: string, userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('recipient_user_id', userId)
    .is('read_at', null);
  return count ?? 0;
}

/** Mark a single notification read (RLS ensures it's the caller's own). */
export async function markRead(
  supabase: DB,
  tenantId: string,
  userId: string,
  notificationId: string,
): Promise<ServiceResult> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('recipient_user_id', userId)
    .eq('id', notificationId)
    .is('read_at', null);
  if (error) return { ok: false, error: 'mark_read_failed' };
  return { ok: true, id: notificationId };
}

/** Mark all of a user's notifications read. */
export async function markAllRead(
  supabase: DB,
  tenantId: string,
  userId: string,
): Promise<ServiceResult> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('recipient_user_id', userId)
    .is('read_at', null);
  if (error) return { ok: false, error: 'mark_all_failed' };
  return { ok: true };
}

/** Read a user's preferences (defaults when no row exists). */
export async function getPreferences(
  supabase: DB,
  tenantId: string,
  userId: string,
): Promise<NotificationPreferences> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('email_enabled, push_enabled, quiet_hours_enabled, muted_kinds')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_PREFS };
  const r = data as Record<string, unknown>;
  return {
    emailEnabled: Boolean(r.email_enabled),
    pushEnabled: Boolean(r.push_enabled),
    quietHoursEnabled: Boolean(r.quiet_hours_enabled),
    mutedKinds: ((r.muted_kinds as string[]) ?? []).filter((k): k is NotificationKind =>
      (NOTIFICATION_KINDS as readonly string[]).includes(k),
    ),
  };
}

export interface UpdatePreferencesInput {
  tenantId: string;
  userId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietHoursEnabled: boolean;
  mutedKinds: string[];
}

/** Upsert a user's preferences (own row; RLS enforces user_id = auth.uid()). */
export async function updatePreferences(
  supabase: DB,
  input: UpdatePreferencesInput,
): Promise<ServiceResult> {
  const mutedKinds = input.mutedKinds.filter((k) =>
    (NOTIFICATION_KINDS as readonly string[]).includes(k),
  );
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      email_enabled: input.emailEnabled,
      push_enabled: input.pushEnabled,
      quiet_hours_enabled: input.quietHoursEnabled,
      muted_kinds: mutedKinds,
    },
    { onConflict: 'tenant_id,user_id' },
  );
  if (error) return { ok: false, error: 'prefs_update_failed' };
  return { ok: true };
}

export interface CreateNotificationInput {
  tenantId: string;
  actorUserId?: string | null;
  recipientUserId: string;
  kind: NotificationKind;
  priority?: NotificationPriority;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
  now?: Date;
  tzOffsetMinutes?: number;
}

export interface CreateNotificationResult extends ServiceResult {
  delivered?: boolean;
  channels?: string[];
  suppressedReason?: string | null;
}

/**
 * Create a notification routed by the PURE `routeNotification` engine. In-app is
 * always recorded when delivered; email/push are recorded as SIMULATED deliveries
 * (`simulated = true`) — never actually sent (no external IO). De-dupes on
 * `dedupe_key` within a short window. Audited NOTIFICATION_CREATED.
 */
export async function createNotification(
  supabase: DB,
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(input.kind))
    return { ok: false, error: 'invalid_kind' };

  const priority: NotificationPriority = input.priority ?? 'normal';
  const now = input.now ?? new Date();
  const tzOffset = input.tzOffsetMinutes ?? 330;

  const prefs = await getPreferences(supabase, input.tenantId, input.recipientUserId);
  // Default quiet-hours window mirrors the follow-up default (20:00–09:00 local).
  const inQuiet = isQuietHours(now, tzOffset, 20, 9);

  const routingInput: NotificationInput = {
    kind: input.kind,
    priority,
    recipientUserId: input.recipientUserId,
    dedupeKey: input.dedupeKey ?? `${input.kind}:${input.recipientUserId}`,
  };
  // dedupeNotifications keeps the single canonical instance for this key.
  const canonical = dedupeNotifications([routingInput])[0] ?? routingInput;
  const routing = routeNotification(canonical, prefs, inQuiet);

  if (!routing.deliver) {
    return {
      ok: true,
      delivered: false,
      channels: [],
      suppressedReason: routing.suppressedReason,
    };
  }

  // De-dupe against a recent identical notification for this recipient.
  if (input.dedupeKey) {
    const windowStart = new Date(now.getTime() - 6 * 3_600_000).toISOString();
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('recipient_user_id', input.recipientUserId)
      .eq('dedupe_key', input.dedupeKey)
      .gte('created_at', windowStart)
      .limit(1);
    if ((existing ?? []).length > 0) {
      return { ok: true, delivered: false, channels: [], suppressedReason: 'deduped' };
    }
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      tenant_id: input.tenantId,
      recipient_user_id: input.recipientUserId,
      kind: input.kind,
      priority,
      title: input.title,
      body: input.body ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      dedupe_key: input.dedupeKey ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'create_failed' };
  const notificationId = data.id as string;

  // Record one delivery per routed channel. External channels are SIMULATED.
  const deliveries = routing.channels.map((channel) => ({
    tenant_id: input.tenantId,
    notification_id: notificationId,
    channel,
    status: channel === 'in_app' ? 'delivered' : 'simulated',
    simulated: channel !== 'in_app',
  }));
  if (deliveries.length > 0) {
    await supabase.from('notification_deliveries').insert(deliveries);
  }

  await writeAudit({
    action: 'NOTIFICATION_CREATED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    entityType: 'notification',
    entityId: notificationId,
    metadata: {
      kind: input.kind,
      priority,
      channels: routing.channels,
      externalSimulated: routing.externalSimulated,
    },
  });

  return {
    ok: true,
    id: notificationId,
    delivered: true,
    channels: routing.channels,
    suppressedReason: routing.suppressedReason,
  };
}
