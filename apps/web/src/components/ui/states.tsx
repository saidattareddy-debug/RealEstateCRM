'use client';

import { ShieldAlert, Inbox, AlertTriangle, WifiOff, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@re/ui';

/** Required, reusable state primitives (docs/UI_SYSTEM.md §1, PAGE_MAP). */

export function PermissionDenied({ message }: { message?: string }) {
  return (
    <Centered
      icon={<ShieldAlert className="h-8 w-8 text-terracotta" aria-hidden />}
      title="Access restricted"
      body={message ?? 'You do not have permission to view this area in the current workspace.'}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Centered
      dashed
      icon={<Inbox className="h-8 w-8 text-text-secondary" aria-hidden />}
      title={title}
      body={hint}
    />
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Centered
      icon={<AlertTriangle className="h-8 w-8 text-warning" aria-hidden />}
      title={title}
      body={message ?? 'An unexpected error occurred. You can retry the action.'}
      action={onRetry ? <RetryButton onRetry={onRetry} /> : undefined}
    />
  );
}

export function OfflineState() {
  return (
    <Centered
      icon={<WifiOff className="h-8 w-8 text-text-secondary" aria-hidden />}
      title="You appear to be offline"
      body="Check your connection — this page will refresh when you are back online."
    />
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface p-10 text-sm text-text-secondary"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-border/60', className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

export function RetryButton({ onRetry, label = 'Retry' }: { onRetry: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
    >
      <RotateCw className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function Centered({
  icon,
  title,
  body,
  action,
  dashed,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border bg-surface p-10 text-center',
        dashed ? 'border-dashed border-border' : 'border-border',
      )}
    >
      <div className="mb-3">{icon}</div>
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {body ? <p className="mt-1 max-w-sm text-sm text-text-secondary">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
