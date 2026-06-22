import Link from 'next/link';
import { cn } from '@re/ui';
import { Panel } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { KPI_DEFS, type MetricKey } from '@/lib/dashboard/config';
import type {
  AttentionLead,
  TaskRow,
  ConversationRow,
  PipelineStageSummary,
  ActivityRow,
  SourceSummary,
} from '@/lib/dashboard/queries';

function rel(at: string | null): string {
  if (!at) return '—';
  const diff = Date.now() - new Date(at).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function dur(at: string | null): string {
  if (!at) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

export function EnvBadge({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-secondary">
      {text}
    </span>
  );
}

export function KpiCard({ metric, value }: { metric: MetricKey; value: number | undefined }) {
  const def = KPI_DEFS[metric];
  return (
    <Link
      href={def.href}
      className="group flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-forest/40 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {def.label}
      </span>
      <span className="text-2xl font-semibold text-text-primary">{value ?? 0}</span>
      <span className="text-xs text-text-secondary">{def.context}</span>
    </Link>
  );
}

export function KpiGrid({
  keys,
  metrics,
}: {
  keys: MetricKey[];
  metrics: Partial<Record<MetricKey, number>>;
}) {
  if (keys.length === 0) return null;
  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-6">
      {keys.map((k) => (
        <div key={k} className="min-w-[60%] snap-start sm:min-w-0">
          <KpiCard metric={k} value={metrics[k]} />
        </div>
      ))}
    </div>
  );
}

const PILL: Record<string, string> = {
  overdue: 'bg-terracotta/15 text-terracotta',
  today: 'bg-champagne/30 text-text-primary',
  upcoming: 'bg-surface-elevated text-text-secondary',
  hot: 'bg-terracotta/15 text-terracotta',
  warm: 'bg-champagne/30 text-text-primary',
};

export function LeadsAttentionPanel({ leads }: { leads: AttentionLead[] }) {
  return (
    <Panel title="Leads requiring attention">
      {leads.length === 0 ? (
        <EmptyState
          title="Nothing needs attention"
          hint="New, hot and warm leads will appear here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {leads.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/leads/${l.id}`}
                  className="truncate text-sm font-medium text-text-primary hover:underline"
                >
                  {l.name}
                </Link>
                <p className="truncate text-xs text-text-secondary">
                  {l.reason}
                  {l.stageName ? ` · ${l.stageName}` : ''} · {rel(l.updatedAt)}
                </p>
              </div>
              {l.category ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    PILL[l.category] ?? PILL.upcoming,
                  )}
                >
                  {l.category}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function TasksPanel({ tasks }: { tasks: TaskRow[] }) {
  return (
    <Panel title="Tasks due">
      {tasks.length === 0 ? (
        <EmptyState title="No open tasks" hint="Overdue and upcoming tasks will appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">{t.title}</p>
                <p className="truncate text-xs text-text-secondary">
                  {t.leadName ? `${t.leadName} · ` : ''}
                  {t.dueAt ? new Date(t.dueAt).toLocaleString() : 'No due date'}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  PILL[t.bucket],
                )}
              >
                {t.bucket}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ConversationsPanel({ rows }: { rows: ConversationRow[] }) {
  return (
    <Panel title="Recent conversations">
      {rows.length === 0 ? (
        <EmptyState title="No conversations yet" hint="Inbound chats appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/inbox/${c.id}`}
                  className="truncate text-sm font-medium text-text-primary hover:underline"
                >
                  {c.subject || c.channel.replace(/_/g, ' ')}
                </Link>
                <p className="truncate text-xs text-text-secondary">
                  {c.channel.replace(/_/g, ' ')} · {c.status}
                  {c.lastInboundAt ? ` · waiting ${dur(c.lastInboundAt)}` : ''}
                </p>
              </div>
              {c.waiting ? (
                <span className="shrink-0 rounded-full bg-terracotta/15 px-2 py-0.5 text-[11px] font-medium text-terracotta">
                  waiting
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PipelinePanel({ stages }: { stages: PipelineStageSummary[] }) {
  return (
    <Panel title="Pipeline overview">
      {stages.length === 0 ? (
        <EmptyState title="No pipeline data" hint="Leads grouped by stage appear here." />
      ) : (
        <ul className="space-y-2">
          {stages.map((s) => (
            <li key={s.name}>
              <Link
                href={`/pipeline?stage=${encodeURIComponent(s.name)}`}
                className="block hover:opacity-90"
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-primary">{s.name}</span>
                  <span className="text-text-secondary">
                    {s.count} · {s.pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                  <div className="h-full rounded-full bg-forest" style={{ width: `${s.pct}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function InventoryAlertsPanel({
  data,
}: {
  data: { available: number; stale: number; needsVerification: number };
}) {
  const items = [
    { label: 'Available units', value: data.available, href: '/inventory?status=available' },
    { label: 'Stale inventory', value: data.stale, href: '/inventory?filter=stale' },
    { label: 'Units to verify', value: data.needsVerification, href: '/inventory?filter=stale' },
  ];
  return (
    <Panel title="Inventory alerts">
      <ul className="divide-y divide-border">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between py-2">
            <Link
              href={i.href}
              className="text-sm text-text-secondary hover:text-text-primary hover:underline"
            >
              {i.label}
            </Link>
            <span className="text-sm font-semibold text-text-primary">{i.value}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ActivityPanel({ rows }: { rows: ActivityRow[] }) {
  return (
    <Panel title="Recent activity">
      {rows.length === 0 ? (
        <EmptyState title="No recent activity" hint="Operational events appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a, i) => (
            <li key={`${a.action}-${i}`} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate text-sm text-text-primary">
                {a.action.replace(/[._]/g, ' ')}
                {a.entityType ? (
                  <span className="text-text-secondary"> · {a.entityType}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-text-secondary">{rel(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SourcesPanel({ sources }: { sources: SourceSummary[] }) {
  return (
    <Panel title="Lead sources">
      {sources.length === 0 ? (
        <EmptyState title="No sources yet" hint="Lead-source volume appears here." />
      ) : (
        <ul className="divide-y divide-border">
          {sources.map((s) => (
            <li key={s.name} className="flex items-center justify-between py-2">
              <span className="truncate text-sm text-text-secondary">{s.name}</span>
              <span className="text-sm font-semibold text-text-primary">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
