'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveStaleAction } from './actions';

export function ReverifyButton({ unitId }: { unitId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await resolveStaleAction(unitId);
          router.refresh();
        })
      }
      className="rounded-md border border-border px-2 py-1 text-xs text-forest hover:bg-surface-elevated disabled:opacity-60"
    >
      {pending ? 'Verifying…' : 'Re-verify'}
    </button>
  );
}
