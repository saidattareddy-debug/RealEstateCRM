'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  UserPlus,
  KanbanSquare,
  ListChecks,
  Building2,
  Boxes,
  BookOpen,
  Users,
  Target,
  Workflow,
  Plug,
  ScrollText,
  Settings,
  FlaskConical,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@re/ui';
import type { PermissionKey } from '@re/validation';
import { buildNavGroups, type NavItem } from './nav-config';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  leads: UserPlus,
  pipeline: KanbanSquare,
  tasks: ListChecks,
  projects: Building2,
  inventory: Boxes,
  knowledge: BookOpen,
  team: Users,
  scoring: Target,
  matching: Workflow,
  integrations: Plug,
  audit: ScrollText,
  settings: Settings,
  beaker: FlaskConical,
};

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon] ?? LayoutDashboard;
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest',
        active
          ? 'bg-forest font-medium text-white'
          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

function CollapsibleGroup({
  id,
  label,
  items,
  pathname,
}: {
  id: string;
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  // Expanded by default; force-open whenever a child route is active.
  const childActive = items.some((i) => pathname === i.href || pathname.startsWith(i.href + '/'));
  const [open, setOpen] = useState(true);
  const expanded = open || childActive;
  return (
    <div className="pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`navgroup-${id}`}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
      >
        {label}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', expanded ? '' : '-rotate-90')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div id={`navgroup-${id}`} className="mt-1 space-y-1">
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({ permissions }: { permissions: PermissionKey[] }) {
  const pathname = usePathname();
  const groups = buildNavGroups(permissions);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="h-6 w-6 rounded-md bg-forest" aria-hidden />
        <span className="text-sm font-semibold text-text-primary">Sales Platform</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Primary">
        {groups.map((group) =>
          group.collapsible && group.label ? (
            <CollapsibleGroup
              key={group.id}
              id={group.id}
              label={group.label}
              items={group.items}
              pathname={pathname}
            />
          ) : (
            <div key={group.id} className="space-y-1">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          ),
        )}
      </nav>
    </aside>
  );
}
