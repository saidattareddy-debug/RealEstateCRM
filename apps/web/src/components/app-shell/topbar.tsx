'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import type { MembershipSummary } from '@/lib/auth';
import { setActiveTenantAction } from '@/app/(app)/actions';
import { signOutAction } from '@/app/(auth)/actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function Topbar({
  memberships,
  activeTenantId,
  email,
  fullName,
}: {
  memberships: MembershipSummary[];
  activeTenantId: string | null;
  email: string;
  fullName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = memberships.find((m) => m.tenantId === activeTenantId);

  function onSwitch(e: React.ChangeEvent<HTMLSelectElement>) {
    const tenantId = e.target.value;
    startTransition(async () => {
      const res = await setActiveTenantAction(tenantId);
      if (res.ok) {
        // Refresh the session so the new active_tenant claim is in the JWT.
        await createSupabaseBrowserClient().auth.refreshSession();
        router.refresh();
      }
    });
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        {memberships.length > 0 ? (
          <select
            aria-label="Active tenant"
            value={activeTenantId ?? ''}
            onChange={onSwitch}
            disabled={pending || memberships.length < 2}
            className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
          >
            {memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.tenantName}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-text-secondary">No workspace</span>
        )}
        {active ? (
          <span className="hidden text-xs text-text-secondary sm:inline">{active.roleName}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-text-secondary sm:inline">{fullName ?? email}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      </div>
    </header>
  );
}
