import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { MobileNav } from '@/components/app-shell/mobile-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();

  // Real inbox unread count for the mobile-nav badge (per-user, RLS-scoped):
  // open conversations whose last inbound message is newer than my read marker.
  let inboxUnread = 0;
  if (ensurePermission(ctx, 'conversations.read.assigned')) {
    const supabase = await createSupabaseServerClient();
    const [{ data: convs }, { data: reads }] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, last_inbound_at')
        .neq('status', 'closed')
        .not('last_inbound_at', 'is', null)
        .limit(300),
      supabase
        .from('conversation_reads')
        .select('conversation_id, last_read_at')
        .eq('profile_id', ctx.userId),
    ]);
    const readBy = new Map<string, string>(
      (reads ?? []).map((r) => [r.conversation_id as string, r.last_read_at as string]),
    );
    inboxUnread = (convs ?? []).filter((c) => {
      const inbound = c.last_inbound_at as string | null;
      if (!inbound) return false;
      const read = readBy.get(c.id as string);
      return !read || new Date(read).getTime() < new Date(inbound).getTime();
    }).length;
  }

  // Apply tenant branding at runtime (white-label, docs/UI_SYSTEM.md §2).
  const brandStyle = ctx.branding
    ? ({
        ['--color-forest' as string]: ctx.branding.primaryColor,
        ['--color-forest-deep' as string]: ctx.branding.secondaryColor,
        ['--color-champagne' as string]: ctx.branding.accentColor,
      } as React.CSSProperties)
    : undefined;

  return (
    <div style={brandStyle} className="flex min-h-screen bg-bg-app">
      <Sidebar permissions={[...ctx.permissions]} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          memberships={ctx.memberships}
          activeTenantId={ctx.activeTenantId}
          email={ctx.email}
          fullName={ctx.fullName}
        />
        {/* pb-20 on mobile keeps content clear of the fixed bottom nav */}
        <main className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">{children}</main>
      </div>
      <MobileNav permissions={[...ctx.permissions]} inboxUnread={inboxUnread} />
    </div>
  );
}
