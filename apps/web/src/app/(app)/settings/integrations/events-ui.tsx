const EVENT_TONE: Record<string, string> = {
  received: 'border-border bg-surface-elevated text-text-secondary',
  processing: 'border-border bg-surface-elevated text-text-secondary',
  processed: 'border-success/40 bg-success/10 text-success',
  duplicate: 'border-border bg-surface-elevated text-text-secondary',
  failed: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
  retry_scheduled: 'border-warning/40 bg-warning/10 text-warning',
  dead_letter: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
  rejected: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
};

export function EventStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
        EVENT_TONE[status] ?? EVENT_TONE.received
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

const FAILURE_TONE: Record<string, string> = {
  retryable: 'border-warning/40 bg-warning/10 text-warning',
  permanent: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
  dead_letter: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
};

export function FailureBadge({ failureClass }: { failureClass: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
        FAILURE_TONE[failureClass] ?? FAILURE_TONE.permanent
      }`}
    >
      {failureClass}
    </span>
  );
}
