import Link from 'next/link';
import { NOTIFICATION_KINDS } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { getPreferences } from '@/lib/notifications/service';
import { PreferencesForm } from './preferences-form';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  lead_assigned: 'Lead assigned to me',
  lead_hot: 'A lead became hot',
  conversation_waiting: 'Conversation waiting on a reply',
  task_due: 'Task due',
  task_overdue: 'Task overdue',
  visit_scheduled: 'Visit scheduled',
  visit_reminder: 'Visit reminder',
  visit_cancelled: 'Visit cancelled',
  sla_breach: 'SLA breach',
  automation_failed: 'Automation failed',
  mention: 'I was mentioned',
};

export default async function NotificationPreferencesPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'notifications.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const prefs = await getPreferences(supabase, ctx.activeTenantId!, ctx.userId);
  const canManage = ensurePermission(ctx, 'notifications.manage');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/notifications" className="text-xs text-text-secondary hover:underline">
          ← Notifications
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Notification preferences</h1>
        <p className="text-sm text-text-secondary">
          Choose which channels you receive and which kinds to mute. In-app notifications are always
          recorded; email and push are simulated in this build.
        </p>
      </header>

      <Panel title="Your preferences">
        {canManage ? (
          <PreferencesForm
            emailEnabled={prefs.emailEnabled}
            pushEnabled={prefs.pushEnabled}
            quietHoursEnabled={prefs.quietHoursEnabled}
            mutedKinds={prefs.mutedKinds}
            kinds={[...NOTIFICATION_KINDS]}
            kindLabels={KIND_LABEL}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            You do not have permission to change notification preferences.
          </p>
        )}
      </Panel>
    </div>
  );
}
