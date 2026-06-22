import { cn } from '@re/ui';

/** Knowledge lifecycle states (public.knowledge_state enum, migration 0017). */
export const KNOWLEDGE_STATES = [
  'draft',
  'processing',
  'review_required',
  'approved',
  'rejected',
  'superseded',
  'archived',
  'failed',
] as const;

const STATE_CLASS: Record<string, string> = {
  draft: 'bg-border/60 text-text-secondary',
  processing: 'bg-border/60 text-text-secondary',
  review_required: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-terracotta/15 text-terracotta',
  superseded: 'bg-border/60 text-text-secondary',
  archived: 'bg-border/60 text-text-secondary',
  failed: 'bg-terracotta/15 text-terracotta',
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATE_CLASS[state] ?? 'bg-border/60 text-text-secondary',
      )}
    >
      {state.replace(/_/g, ' ')}
    </span>
  );
}
