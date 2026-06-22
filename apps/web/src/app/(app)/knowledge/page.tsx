import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { StateBadge, KNOWLEDGE_STATES } from './state-badge';

export const dynamic = 'force-dynamic';

interface SourceRow {
  id: string;
  project_id: string | null;
  source_type: string;
  title: string;
  language: string;
  state: string;
  last_verified_at: string | null;
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; project?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'knowledge.read')) return <PermissionDenied />;

  const sp = await searchParams;
  const tenantId = ctx.activeTenantId!;
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('knowledge_sources')
    .select('id, project_id, source_type, title, language, state, last_verified_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (sp.state && (KNOWLEDGE_STATES as readonly string[]).includes(sp.state)) {
    query = query.eq('state', sp.state);
  }
  if (sp.project) query = query.eq('project_id', sp.project);

  const [{ data: sourcesData }, { data: projectsData }] = await Promise.all([
    query,
    supabase
      .from('projects')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true }),
  ]);

  const sources = (sourcesData as SourceRow[] | null) ?? [];
  const projects = (projectsData as { id: string; name: string }[] | null) ?? [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const sourceIds = sources.map((s) => s.id);

  // Aggregate counts per source (chunks, embeddings, conflicts, errors, versions).
  const chunkCount = new Map<string, number>();
  const embeddedSources = new Set<string>();
  const versionCount = new Map<string, number>();
  const conflictCount = new Map<string, number>();
  const errorCount = new Map<string, number>();

  if (sourceIds.length > 0) {
    const [{ data: chunks }, { data: versions }] = await Promise.all([
      supabase
        .from('knowledge_chunks')
        .select('id, source_id')
        .eq('tenant_id', tenantId)
        .in('source_id', sourceIds),
      supabase
        .from('knowledge_source_versions')
        .select('id, source_id')
        .eq('tenant_id', tenantId)
        .in('source_id', sourceIds),
    ]);

    const chunkRows = (chunks as { id: string; source_id: string }[] | null) ?? [];
    const chunkBySource = new Map<string, string[]>();
    for (const c of chunkRows) {
      chunkCount.set(c.source_id, (chunkCount.get(c.source_id) ?? 0) + 1);
      const arr = chunkBySource.get(c.source_id) ?? [];
      arr.push(c.id);
      chunkBySource.set(c.source_id, arr);
    }
    for (const v of (versions as { source_id: string }[] | null) ?? []) {
      versionCount.set(v.source_id, (versionCount.get(v.source_id) ?? 0) + 1);
    }

    const allChunkIds = chunkRows.map((c) => c.id);
    if (allChunkIds.length > 0) {
      const { data: embeddings } = await supabase
        .from('knowledge_chunk_embeddings')
        .select('chunk_id')
        .eq('tenant_id', tenantId)
        .in('chunk_id', allChunkIds);
      const embeddedChunks = new Set(
        ((embeddings as { chunk_id: string }[] | null) ?? []).map((e) => e.chunk_id),
      );
      for (const [sourceId, ids] of chunkBySource) {
        if (ids.some((id) => embeddedChunks.has(id))) embeddedSources.add(sourceId);
      }
    }

    // Conflicts + ingestion errors are scoped per-project/job, so aggregate by
    // the source's project where available (conflicts) and per source's jobs.
    const projectIds = Array.from(
      new Set(sources.map((s) => s.project_id).filter((x): x is string => Boolean(x))),
    );
    if (projectIds.length > 0) {
      const { data: conflicts } = await supabase
        .from('knowledge_conflicts')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
        .in('project_id', projectIds);
      const byProject = new Map<string, number>();
      for (const c of (conflicts as { project_id: string | null }[] | null) ?? []) {
        if (c.project_id) byProject.set(c.project_id, (byProject.get(c.project_id) ?? 0) + 1);
      }
      for (const s of sources) {
        if (s.project_id && byProject.has(s.project_id)) {
          conflictCount.set(s.id, byProject.get(s.project_id)!);
        }
      }
    }

    const { data: jobs } = await supabase
      .from('knowledge_ingestion_jobs')
      .select('id, source_id')
      .eq('tenant_id', tenantId)
      .in('source_id', sourceIds);
    const jobToSource = new Map<string, string>();
    for (const j of (jobs as { id: string; source_id: string | null }[] | null) ?? []) {
      if (j.source_id) jobToSource.set(j.id, j.source_id);
    }
    const jobIds = Array.from(jobToSource.keys());
    if (jobIds.length > 0) {
      const { data: errors } = await supabase
        .from('knowledge_ingestion_errors')
        .select('job_id')
        .eq('tenant_id', tenantId)
        .in('job_id', jobIds);
      for (const e of (errors as { job_id: string | null }[] | null) ?? []) {
        const src = e.job_id ? jobToSource.get(e.job_id) : undefined;
        if (src) errorCount.set(src, (errorCount.get(src) ?? 0) + 1);
      }
    }
  }

  const canCreate = ensurePermission(ctx, 'knowledge.create');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Knowledge</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Approved sources ground AI answers. Only approved, in-effect knowledge is retrievable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/knowledge/review"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
          >
            Review queue
          </Link>
          {canCreate ? (
            <Link
              href="/knowledge/new"
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
            >
              New source
            </Link>
          ) : null}
        </div>
      </div>

      <Panel>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-text-secondary">
            State
            <select
              name="state"
              defaultValue={sp.state ?? ''}
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            >
              <option value="">All states</option>
              {KNOWLEDGE_STATES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-text-secondary">
            Project
            <select
              name="project"
              defaultValue={sp.project ?? ''}
              className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
          >
            Apply
          </button>
          {sp.state || sp.project ? (
            <Link
              href="/knowledge"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {sources.length === 0 ? (
          <EmptyState
            title="No knowledge sources"
            hint={
              canCreate
                ? 'Create a source to ground AI answers in approved facts.'
                : 'No sources match the current filters.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">State</th>
                  <th className="pb-2 font-medium">Lang</th>
                  <th className="pb-2 text-right font-medium">Versions</th>
                  <th className="pb-2 text-right font-medium">Chunks</th>
                  <th className="pb-2 font-medium">Embeddings</th>
                  <th className="pb-2 text-right font-medium">Conflicts</th>
                  <th className="pb-2 text-right font-medium">Errors</th>
                  <th className="pb-2 font-medium">Verified</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const conflicts = conflictCount.get(s.id) ?? 0;
                  const errors = errorCount.get(s.id) ?? 0;
                  return (
                    <tr key={s.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2">
                        <Link
                          href={`/knowledge/${s.id}`}
                          className="font-medium text-forest hover:underline"
                        >
                          {s.title}
                        </Link>
                      </td>
                      <td className="py-2 text-text-secondary">
                        {s.project_id ? (projectName.get(s.project_id) ?? '—') : 'Global'}
                      </td>
                      <td className="py-2 capitalize text-text-secondary">
                        {s.source_type.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2">
                        <StateBadge state={s.state} />
                      </td>
                      <td className="py-2 uppercase text-text-secondary">{s.language}</td>
                      <td className="py-2 text-right text-text-secondary">
                        {versionCount.get(s.id) ?? 0}
                      </td>
                      <td className="py-2 text-right text-text-secondary">
                        {chunkCount.get(s.id) ?? 0}
                      </td>
                      <td className="py-2 text-text-secondary">
                        {embeddedSources.has(s.id) ? (
                          <span className="text-success">Yes</span>
                        ) : (
                          <span className="text-text-secondary">No</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {conflicts > 0 ? (
                          <span className="text-warning">{conflicts}</span>
                        ) : (
                          <span className="text-text-secondary">0</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {errors > 0 ? (
                          <span className="text-terracotta">{errors}</span>
                        ) : (
                          <span className="text-text-secondary">0</span>
                        )}
                      </td>
                      <td className="py-2 text-text-secondary">{fmtDate(s.last_verified_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
