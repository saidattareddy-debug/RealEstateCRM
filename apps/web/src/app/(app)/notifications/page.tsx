import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { listNotifications } from '@/lib/notifications/service';
import { MarkReadButton, MarkAllReadButton } from './notifications-forms';

export const dynamic = 'force-dynamic';

const PRIORITY_STYLE: Record<string, string> = {
  low: 'bg-border/40 text-text-secondary',
  normal: 'bg-forest/10 text-forest',
  high: 'bg-warning/10 text-warning',
  urgent: 'bg-terracotta/10 text-terracotta',
};

export default async function NotificationsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'notifications.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const notifications = await listNotifications(supabase, ctx.activeTenantId!, ctx.userId);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-text-primary">Notifications</h1>
          <p className="text-sm text-text-secondary">
            {unread > 0 ? `${unread} unread` : 'You are all caught up.'}{' '}
            <Link href="/settings/notifications" className="text-forest hover:underline">
              Preferences
            </Link>
          </p>
        </div>
        {unread > 0 && <MarkAllReadButton />}
      </header>

      <Panel>
        {notifications.length === 0 ? (
          <EmptyState title="No notifications" />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-3 ${
                  n.readAt ? 'opacity-70' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.readAt && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-forest" aria-hidden />
                    )}
                    <p className="text-sm font-medium text-text-primary">{n.title}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        PRIORITY_STYLE[n.priority] ?? PRIORITY_STYLE.normal
                      }`}
                    >
                      {n.priority}
                    </span>
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-text-secondary">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {n.kind} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                {!n.readAt && <MarkReadButton notificationId={n.id} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
