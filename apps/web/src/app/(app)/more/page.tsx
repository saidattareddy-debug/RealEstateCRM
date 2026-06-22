import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { Panel } from '@/components/ui/card';
import { SignOutButton } from '@/components/app-shell/sign-out-button';

/** Mobile "More" menu — aggregates the live secondary destinations. */
export default async function MorePage() {
  const ctx = await getAppContext();
  const links: { href: string; label: string }[] = [];
  if (ensurePermission(ctx, 'settings.audit.read'))
    links.push({ href: '/audit', label: 'Audit log' });
  if (ensurePermission(ctx, 'team.performance.read')) links.push({ href: '/team', label: 'Team' });
  if (ensurePermission(ctx, 'settings.org.manage'))
    links.push({ href: '/settings', label: 'Settings' });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">More</h1>
      <Panel>
        <ul className="divide-y divide-border/60">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center justify-between py-3 text-sm text-text-primary hover:text-forest"
              >
                {l.label}
                <span aria-hidden>›</span>
              </Link>
            </li>
          ))}
          {links.length === 0 ? (
            <li className="py-3 text-sm text-text-secondary">No additional areas available.</li>
          ) : null}
        </ul>
      </Panel>
      <SignOutButton />
    </div>
  );
}
