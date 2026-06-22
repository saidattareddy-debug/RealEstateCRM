'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Inbox, Users, ListChecks, Menu, type LucideIcon } from 'lucide-react';
import { cn } from '@re/ui';
import { MOBILE_NAV, type MobileNavItem } from './nav-config';

const ICONS: Record<MobileNavItem['icon'], LucideIcon> = {
  today: CalendarDays,
  inbox: Inbox,
  leads: Users,
  tasks: ListChecks,
  more: Menu,
};

/**
 * Fixed bottom navigation, visible below the desktop breakpoint only.
 * iOS safe-area aware, 44px+ touch targets, keyboard- and screen-reader-
 * accessible, active-route indication, light/dark themed (docs/UI_SYSTEM.md §5).
 */
export function MobileNav({
  permissions,
  inboxUnread = 0,
}: {
  permissions: string[];
  inboxUnread?: number;
}) {
  const pathname = usePathname();
  const perms = new Set(permissions);
  const items = MOBILE_NAV.filter((i) => !i.requires || perms.has(i.requires));

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const target = item.href.split('?')[0] ?? item.href;
          const active =
            pathname === target || (target !== '/dashboard' && pathname.startsWith(target));
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium',
                  active ? 'text-forest' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden />
                  {item.icon === 'inbox' && inboxUnread > 0 ? (
                    <span
                      aria-label={`${inboxUnread} unread`}
                      className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-terracotta px-1 text-[10px] font-semibold leading-4 text-white"
                    >
                      {inboxUnread > 99 ? '99+' : inboxUnread}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
