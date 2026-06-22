import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { StateBadge } from '../state-badge';
import { SourceControls, TestRetrievalBox } from './source-controls';

export const dynamic = 'force-dynamic';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const CHUNK_PREVIEW_LIMIT = 8;

export default async function KnowledgeSourceDetailPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'knowledge.read')) return <PermissionDenied />;

  const tenantId = ctx.activeTenantId!;
  const supabase = await createSupabaseServerClient();

  const { data: sourceData } = await supabase
    .from('knowledge_sources')
    .select(
      'id, project_id, source_type, title, language, trust_priority, state, approved_at, effective_at, expires_at, last_verified_at, extraction_status, machine_translated, notes, created_at',
    )
    .eq('id', sourceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!sourceData) notFound();
  const source = sourceData as {
    id: string;
    project_id: string | null;
    source_type: string;
    title: string;
    language: string;
    trust_priority: number;
    state: string;
    approved_at: string | null;
    effective_at: string | null;
    expires_at: string | null;
    last_verified_at: string | null;
    extraction_status: string;
    machine_translated: boolean;
    notes: string | null;
    created_at: string;
  };

  const [{ data: versionsData }, { data: chunksData }, { data: eventsData }, { data: project }] =
    await Promise.all([
      supabase
        .from('knowledge_source_versions')
        .select('id, version, state, change_summary, approval_reason, approved_at, created_at')
        .eq('source_id', sourceId)
        .eq('tenant_id', tenantId)
        .order('version', { ascending: false }),
      supabase
        .from('knowledge_chunks')
        .select('id, chunk_index, heading, content, token_estimate, state')
        .eq('source_id', sourceId)
        .eq('tenant_id', tenantId)
        .order('chunk_index', { ascending: true })
        .limit(CHUNK_PREVIEW_LIMIT),
      supabase
        .from('knowledge_approval_events')
        .select('id, from_state, to_state, reason, created_at')
        .eq('source_id', sourceId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      source.project_id
        ? supabase.from('projects').select('id, name').eq('id', source.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const versions =
    (versionsData as
      | {
          id: string;
          version: number;
          state: string;
          change_summary: string | null;
          approval_reason: string | null;
          approved_at: string | null;
          created_at: string;
        }[]
      | null) ?? [];
  const chunks =
    (chunksData as
      | {
          id: string;
          chunk_index: number;
          heading: string | null;
          content: string;
          token_estimate: number;
          state: string;
        }[]
      | null) ?? [];
  const events =
    (eventsData as
      | {
          id: string;
          from_state: string | null;
          to_state: string;
          reason: string | null;
          created_at: string;
        }[]
      | null) ?? [];

  // Embedding status: any embedded chunk for this source.
  const { count: totalChunkCount } = await supabase
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)
    .eq('tenant_id', tenantId);

  const chunkIdsForEmbedding = chunks.map((c) => c.id);
  let hasEmbeddings = false;
  if (chunkIdsForEmbedding.length > 0) {
    const { count } = await supabase
      .from('knowledge_chunk_embeddings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('chunk_id', chunkIdsForEmbedding);
    hasEmbeddings = (count ?? 0) > 0;
  }

  // Open conflicts scoped to this source's project (project-level signal).
  let openConflicts: { id: string; conflict_type: string; created_at: string }[] = [];
  if (source.project_id) {
    const { data: conflictsData } = await supabase
      .from('knowledge_conflicts')
      .select('id, conflict_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('project_id', source.project_id)
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    openConflicts =
      (conflictsData as { id: string; conflict_type: string; created_at: string }[] | null) ?? [];
  }

  const projectName = (project as { id: string; name: string } | null)?.name ?? null;
  const canReview = ensurePermission(ctx, 'knowledge.review');
  const canApprove = ensurePermission(ctx, 'knowledge.approve');
  const canArchive = ensurePermission(ctx, 'knowledge.archive');

  return (
    <div className="space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-forest hover:underline">
          ← Back to knowledge
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary">{source.title}</h1>
          <StateBadge state={source.state} />
        </div>
      </div>

      <Panel title="Source details">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Project" value={source.project_id ? (projectName ?? '—') : 'Global'} />
          <Field label="Type" value={source.source_type.replace(/_/g, ' ')} capitalize />
          <Field label="Language" value={source.language.toUpperCase()} />
          <Field label="Trust priority" value={String(source.trust_priority)} />
          <Field label="Extraction" value={source.extraction_status} capitalize />
          <Field label="Machine translated" value={source.machine_translated ? 'Yes' : 'No'} />
          <Field label="Approved" value={fmtDateTime(source.approved_at)} />
          <Field label="Effective" value={fmtDateTime(source.effective_at)} />
          <Field label="Expires" value={fmtDateTime(source.expires_at)} />
          <Field label="Last verified" value={fmtDateTime(source.last_verified_at)} />
          <Field label="Created" value={fmtDateTime(source.created_at)} />
          <Field label="Embeddings" value={hasEmbeddings ? 'Generated' : 'None'} />
        </dl>
        {source.notes ? (
          <p className="mt-4 rounded-md border border-border bg-surface-elevated p-3 text-sm text-text-secondary">
            {source.notes}
          </p>
        ) : null}
      </Panel>

      <SourceControls
        sourceId={source.id}
        versions={versions.map((v) => ({ version: v.version, state: v.state }))}
        canReview={canReview}
        canApprove={canApprove}
        canArchive={canArchive}
      />

      <Panel title="Extracted text — chunk preview">
        {chunks.length === 0 ? (
          <p className="text-sm text-text-secondary">No chunks extracted yet.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-text-secondary">
              Showing first {chunks.length} of {totalChunkCount ?? chunks.length} chunks.
            </p>
            <ul className="space-y-3">
              {chunks.map((c) => (
                <li key={c.id} className="rounded-md border border-border bg-surface-elevated p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">#{c.chunk_index}</span>
                    {c.heading ? <span>· {c.heading}</span> : null}
                    <span>· ~{c.token_estimate} tokens</span>
                    <StateBadge state={c.state} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-text-primary">
                    {c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Version history">
        {versions.length === 0 ? (
          <p className="text-sm text-text-secondary">No versions recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Version</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Summary</th>
                <th className="pb-2 font-medium">Approved</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 font-medium text-text-primary">v{v.version}</td>
                  <td className="py-2">
                    <StateBadge state={v.state} />
                  </td>
                  <td className="py-2 text-text-secondary">{v.change_summary ?? '—'}</td>
                  <td className="py-2 text-text-secondary">{fmtDateTime(v.approved_at)}</td>
                  <td className="py-2 text-text-secondary">{fmtDateTime(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Approval history">
        {events.length === 0 ? (
          <p className="text-sm text-text-secondary">No approval events.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-2">
                <StateBadge state={ev.from_state ?? 'draft'} />
                <span className="text-text-secondary">→</span>
                <StateBadge state={ev.to_state} />
                {ev.reason ? <span className="text-text-secondary">— {ev.reason}</span> : null}
                <span className="ml-auto text-xs text-text-secondary">
                  {fmtDateTime(ev.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Conflicts">
        {openConflicts.length === 0 ? (
          <p className="text-sm text-text-secondary">No open conflicts for this project.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {openConflicts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border p-2"
              >
                <span className="capitalize text-text-primary">
                  {c.conflict_type.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-text-secondary">{fmtDateTime(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Test retrieval">
        <TestRetrievalBox projectId={source.project_id} language={source.language} />
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-text-secondary">{label}</dt>
      <dd className={capitalize ? 'capitalize text-text-primary' : 'text-text-primary'}>{value}</dd>
    </div>
  );
}
