import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { StateBadge } from '../state-badge';

export const dynamic = 'force-dynamic';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// Knowledge is "stale" if it was last verified longer ago than this.
const STALE_DAYS = 90;
// Offers are "expiring soon" within this window.
const EXPIRY_SOON_DAYS = 14;

export default async function KnowledgeReviewPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'knowledge.read')) return <PermissionDenied />;

  const tenantId = ctx.activeTenantId!;
  const supabase = await createSupabaseServerClient();
  const now = Date.now();
  const staleCutoff = new Date(now - STALE_DAYS * 86400000).toISOString();
  const expirySoonCutoff = new Date(now + EXPIRY_SOON_DAYS * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();

  const [
    { data: pending },
    { data: failed },
    { data: jobs },
    { data: conflicts },
    { data: offers },
    { data: projectsData },
  ] = await Promise.all([
    // Pending approvals.
    supabase
      .from('knowledge_sources')
      .select('id, title, project_id, source_type, state, created_at')
      .eq('tenant_id', tenantId)
      .eq('state', 'review_required')
      .order('created_at', { ascending: false }),
    // Failed ingestion (state failed).
    supabase
      .from('knowledge_sources')
      .select('id, title, project_id, source_type, state, created_at')
      .eq('tenant_id', tenantId)
      .eq('state', 'failed')
      .order('created_at', { ascending: false }),
    // Ingestion error rows (with their source via the job).
    supabase.from('knowledge_ingestion_jobs').select('id, source_id').eq('tenant_id', tenantId),
    // Open conflicts.
    supabase
      .from('knowledge_conflicts')
      .select('id, project_id, conflict_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .order('created_at', { ascending: false }),
    // Expiring offers (approved offers with expires_at soon).
    supabase
      .from('knowledge_sources')
      .select('id, title, project_id, expires_at')
      .eq('tenant_id', tenantId)
      .eq('source_type', 'offer')
      .eq('state', 'approved')
      .not('expires_at', 'is', null)
      .lte('expires_at', expirySoonCutoff)
      .order('expires_at', { ascending: true }),
    supabase.from('projects').select('id, name').eq('tenant_id', tenantId),
  ]);

  const projects = (projectsData as { id: string; name: string }[] | null) ?? [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const labelProject = (id: string | null) => (id ? (projectName.get(id) ?? '—') : 'Global');

  // Stale + expired approved knowledge (verified long ago, or already expired).
  const { data: staleData } = await supabase
    .from('knowledge_sources')
    .select('id, title, project_id, source_type, last_verified_at, expires_at')
    .eq('tenant_id', tenantId)
    .eq('state', 'approved')
    .or(`last_verified_at.lte.${staleCutoff},last_verified_at.is.null,expires_at.lte.${nowIso}`)
    .order('last_verified_at', { ascending: true, nullsFirst: true });
  const stale =
    (staleData as
      | {
          id: string;
          title: string;
          project_id: string | null;
          source_type: string;
          last_verified_at: string | null;
          expires_at: string | null;
        }[]
      | null) ?? [];

  // Ingestion errors: fetch and map back to sources through their jobs.
  const jobToSource = new Map<string, string | null>();
  for (const j of (jobs as { id: string; source_id: string | null }[] | null) ?? []) {
    jobToSource.set(j.id, j.source_id);
  }
  const jobIds = Array.from(jobToSource.keys());
  let ingestionErrors: {
    id: string;
    category: string;
    summary: string | null;
    created_at: string;
    sourceId: string | null;
  }[] = [];
  if (jobIds.length > 0) {
    const { data: errData } = await supabase
      .from('knowledge_ingestion_errors')
      .select('id, job_id, category, summary, created_at')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });
    ingestionErrors = (
      (errData as
        | {
            id: string;
            job_id: string | null;
            category: string;
            summary: string | null;
            created_at: string;
          }[]
        | null) ?? []
    ).map((e) => ({
      id: e.id,
      category: e.category,
      summary: e.summary,
      created_at: e.created_at,
      sourceId: e.job_id ? (jobToSource.get(e.job_id) ?? null) : null,
    }));
  }

  // Detected injection attempts: flagged document versions, mapped to source.
  const { data: docs } = await supabase
    .from('knowledge_documents')
    .select('id, source_id, title')
    .eq('tenant_id', tenantId);
  const docToSource = new Map<string, { sourceId: string; title: string }>();
  for (const d of (docs as { id: string; source_id: string; title: string }[] | null) ?? []) {
    docToSource.set(d.id, { sourceId: d.source_id, title: d.title });
  }
  const docIds = Array.from(docToSource.keys());
  let injection: {
    id: string;
    categories: string[];
    created_at: string;
    sourceId: string;
    title: string;
  }[] = [];
  if (docIds.length > 0) {
    const { data: flagged } = await supabase
      .from('knowledge_document_versions')
      .select('id, document_id, injection_categories, created_at')
      .eq('tenant_id', tenantId)
      .eq('injection_flagged', true)
      .in('document_id', docIds)
      .order('created_at', { ascending: false });
    injection = (
      (flagged as
        | {
            id: string;
            document_id: string;
            injection_categories: string[] | null;
            created_at: string;
          }[]
        | null) ?? []
    )
      .map((f) => {
        const ref = docToSource.get(f.document_id);
        if (!ref) return null;
        return {
          id: f.id,
          categories: f.injection_categories ?? [],
          created_at: f.created_at,
          sourceId: ref.sourceId,
          title: ref.title,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  const pendingRows =
    (pending as
      | {
          id: string;
          title: string;
          project_id: string | null;
          source_type: string;
          state: string;
          created_at: string;
        }[]
      | null) ?? [];
  const failedRows =
    (failed as
      | {
          id: string;
          title: string;
          project_id: string | null;
          source_type: string;
          state: string;
          created_at: string;
        }[]
      | null) ?? [];
  const conflictRows =
    (conflicts as
      | {
          id: string;
          project_id: string | null;
          conflict_type: string;
          created_at: string;
        }[]
      | null) ?? [];
  const offerRows =
    (offers as
      | {
          id: string;
          title: string;
          project_id: string | null;
          expires_at: string | null;
        }[]
      | null) ?? [];

  const canReview =
    ensurePermission(ctx, 'knowledge.review') || ensurePermission(ctx, 'knowledge.approve');

  const sourceLink = (id: string | null, label: React.ReactNode) =>
    id ? (
      <Link href={`/knowledge/${id}`} className="font-medium text-forest hover:underline">
        {label}
      </Link>
    ) : (
      <span className="text-text-primary">{label}</span>
    );

  const totalItems =
    pendingRows.length +
    failedRows.length +
    ingestionErrors.length +
    injection.length +
    conflictRows.length +
    stale.length +
    offerRows.length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-forest hover:underline">
          ← Back to knowledge
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Review queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {canReview
            ? 'Items needing attention. Open a source to approve, reject, or resolve.'
            : 'Items needing attention. You have read-only access; review actions require additional permissions.'}
        </p>
      </div>

      {totalItems === 0 ? (
        <EmptyState title="Nothing to review" hint="No pending, failed, or stale knowledge." />
      ) : null}

      <Panel title={`Pending approvals (${pendingRows.length})`}>
        {pendingRows.length === 0 ? (
          <p className="text-sm text-text-secondary">No sources awaiting review.</p>
        ) : (
          <ul className="divide-y divide-border">
            {pendingRows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                {sourceLink(s.id, s.title)}
                <span className="text-xs capitalize text-text-secondary">
                  {s.source_type.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-text-secondary">{labelProject(s.project_id)}</span>
                <StateBadge state={s.state} />
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(s.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Failed ingestion (${failedRows.length + ingestionErrors.length})`}>
        {failedRows.length === 0 && ingestionErrors.length === 0 ? (
          <p className="text-sm text-text-secondary">No ingestion failures.</p>
        ) : (
          <ul className="divide-y divide-border">
            {failedRows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                {sourceLink(s.id, s.title)}
                <StateBadge state={s.state} />
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(s.created_at)}
                </span>
              </li>
            ))}
            {ingestionErrors.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                {sourceLink(e.sourceId, e.summary ? `${e.category}: ${e.summary}` : e.category)}
                <span className="rounded-full bg-terracotta/15 px-2 py-0.5 text-xs font-medium capitalize text-terracotta">
                  {e.category.replace(/_/g, ' ')}
                </span>
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Detected injection attempts (${injection.length})`}>
        {injection.length === 0 ? (
          <p className="text-sm text-text-secondary">No flagged content.</p>
        ) : (
          <ul className="divide-y divide-border">
            {injection.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                {sourceLink(f.sourceId, f.title)}
                {f.categories.length > 0 ? (
                  <span className="text-xs text-warning">{f.categories.join(', ')}</span>
                ) : (
                  <span className="text-xs text-warning">flagged</span>
                )}
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(f.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Open conflicts (${conflictRows.length})`}>
        {conflictRows.length === 0 ? (
          <p className="text-sm text-text-secondary">No open conflicts.</p>
        ) : (
          <ul className="divide-y divide-border">
            {conflictRows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="capitalize text-text-primary">
                  {c.conflict_type.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-text-secondary">{labelProject(c.project_id)}</span>
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(c.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Stale knowledge (${stale.length})`}>
        {stale.length === 0 ? (
          <p className="text-sm text-text-secondary">No stale or expired approved knowledge.</p>
        ) : (
          <ul className="divide-y divide-border">
            {stale.map((s) => {
              const expired = s.expires_at ? new Date(s.expires_at).getTime() <= now : false;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                  {sourceLink(s.id, s.title)}
                  <span className="text-xs capitalize text-text-secondary">
                    {s.source_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-text-secondary">{labelProject(s.project_id)}</span>
                  {expired ? (
                    <span className="rounded-full bg-terracotta/15 px-2 py-0.5 text-xs font-medium text-terracotta">
                      expired
                    </span>
                  ) : (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                      stale
                    </span>
                  )}
                  <span className="ml-auto text-xs text-text-secondary">
                    verified {fmtDateTime(s.last_verified_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={`Expiring offers (${offerRows.length})`}>
        {offerRows.length === 0 ? (
          <p className="text-sm text-text-secondary">No offers expiring soon.</p>
        ) : (
          <ul className="divide-y divide-border">
            {offerRows.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
                {sourceLink(o.id, o.title)}
                <span className="text-xs text-text-secondary">{labelProject(o.project_id)}</span>
                <span className="ml-auto text-xs text-warning">
                  expires {fmtDateTime(o.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
