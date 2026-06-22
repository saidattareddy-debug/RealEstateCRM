import { LogOut } from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        <span className={compact ? 'hidden sm:inline' : ''}>Sign out</span>
      </button>
    </form>
  );
}
