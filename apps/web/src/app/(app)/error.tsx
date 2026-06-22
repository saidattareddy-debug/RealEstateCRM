'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/states';

/** Route-level error boundary for the authenticated app. Never shows a raw stack. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Hook for Sentry/structured logging (added in a later phase).
    console.error('[app error boundary]', error.digest ?? error.message);
  }, [error]);

  return (
    <ErrorState
      message="This page failed to load. The error has been logged. You can retry."
      onRetry={reset}
    />
  );
}
