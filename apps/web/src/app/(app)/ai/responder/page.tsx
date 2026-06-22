import Link from 'next/link';
import { cn } from '@re/ui';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';

export const dynamic = 'force-dynamic';

const OUTCOME_CLASS: Record<string, string> = {
  suppressed: 'bg-warning/15 text-warning',
  escalate: 'bg-terracotta/15 text-terracotta',
  blocked: 'bg-border/60 text-text-secondary',
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        OUTCOME_CLASS[outcome] ?? 'bg-border/60 text-text-secondary',
      )}
    >
      {outcome}
    </span>
  );
}

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

interface DecisionRow {
  id: string;
  conversation_id: string | null;
  outcome: string;
  reason: string;
  candidate_body: string | null;
  created_at: string;
}

const OUTCOMES = ['suppressed', 'escalate', 'blocked'] as const;
type Outcome = (typeof OUTCOMES)[number];

async function countOutcome(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  outcome?: Outcome,
): Promise<number> {
  let q = supabase.from('ai_responder_decisions').select('id', { count: 'exact', head: true });
  if (outcome) q = q.eq('outcome', outcome);
  const { count } = await q;
  return count ?? 0;
}

export default async function ResponderReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.runs.read')) return <PermissionDenied />;

  const sp = await searchParams;
  const active = (OUTCOMES as readonly string[]).includes(sp.outcome ?? '')
    ? (sp.outcome as Outcome)
    : null;

  const supabase = await createSupabaseServerClient();
  // RLS scopes these to the active tenant; we never trust a client tenant id.
  let listQuery = supabase
    .from('ai_responder_decisions')
    .select('id, conversation_id, outcome, reason, candidate_body, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (active) listQuery = listQuery.eq('outcome', active);

  const [{ data, error }, total, suppressed, escalate, blocked] = await Promise.all([
    listQuery,
    countOutcome(supabase),
    countOutcome(supabase, 'suppressed'),
    countOutcome(supabase, 'escalate'),
    countOutcome(supabase, 'blocked'),
  ]);
  const rows = (data ?? []) as DecisionRow[];
  const filters: { key: Outcome | null; label: string; count: number }[] = [
    { key: null, label: 'All', count: total },
    { key: 'suppressed', label: 'Suppressed', count: suppressed },
    { key: 'escalate', label: 'Escalate', count: escalate },
    { key: 'blocked', label: 'Blocked', count: blocked },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">AI Responder — review</h1>
        <p className="text-sm text-text-secondary">
          What the automatic responder <em>would</em> do on inbound messages in AI-mode
          conversations. Nothing here is sent to a customer — automatic sending is disabled, so
          every grounded reply is recorded as <strong>suppressed</strong> for your review rather
          than delivered. <code>escalate</code> and <code>blocked</code> rows never had a reply.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const isActive = active === f.key;
          return (
            <Link
              key={f.label}
              href={f.key ? `/ai/responder?outcome=${f.key}` : '/ai/responder'}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                isActive
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:bg-surface-elevated',
              )}
            >
              {f.label} <span className="font-mono text-xs">({f.count})</span>
            </Link>
          );
        })}
      </div>

      <Panel title={`Recent decisions${active ? ` · ${active}` : ''}`}>
        {error ? (
          <EmptyState
            title="Couldn’t load responder decisions"
            hint="Please retry. If this persists, the responder log may be unavailable."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No responder decisions yet"
            hint="When a customer sends a message in an AI-mode conversation, the responder records a (non-sent) decision here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="flex items-center gap-2 sm:w-40 sm:shrink-0">
                  <OutcomeBadge outcome={r.outcome} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-text-secondary">{r.reason}</p>
                  {r.candidate_body ? (
                    <p className="mt-1 line-clamp-3 text-sm text-text-primary">
                      <span className="text-text-secondary">Would-be reply (not sent): </span>
                      {r.candidate_body}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-secondary sm:w-48 sm:shrink-0 sm:flex-col sm:items-end">
                  <span>{fmtDateTime(r.created_at)}</span>
                  {r.conversation_id ? (
                    <Link
                      href={`/inbox/${r.conversation_id}`}
                      className="text-accent hover:underline"
                    >
                      Open conversation
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
