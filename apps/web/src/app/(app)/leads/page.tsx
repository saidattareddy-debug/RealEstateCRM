import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { CreateLeadForm, ImportLeadsForm } from './lead-forms';
import { BulkLeadEditor } from './bulk-leads';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  qualifying: 'Qualifying',
  needs_review: 'Needs review',
  nurturing: 'Nurturing',
  dormant: 'Dormant',
  disqualified: 'Disqualified',
};

const CLASSIFICATION_OPTIONS = [
  'hot',
  'warm',
  'cold',
  'disqualified',
  'review_required',
  'unscored',
] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    classification?: string;
    scoreMin?: string;
    scoreMax?: string;
    sort?: string;
  }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'leads.read.assigned')) return <PermissionDenied />;
  const sp = await searchParams;
  const canReadScore = ensurePermission(ctx, 'scoring.read');

  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('leads')
    .select(
      'id, full_name, primary_phone_national, primary_email, operational_status, category, score, pipeline_stages(name)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (sp.status) q = q.eq('operational_status', sp.status);
  const { data: leadsRaw } = await q;

  // Latest score run per lead (advisory). We map by lead and apply score +
  // classification filters in memory. Pipeline is NOT auto-reordered unless the
  // user explicitly chooses score sorting.
  const scoreByLead = new Map<string, { score: number; classification: string }>();
  if (canReadScore && leadsRaw && leadsRaw.length > 0) {
    const { data: runs } = await supabase
      .from('lead_score_runs')
      .select('lead_id, score, classification, calculated_at')
      .in(
        'lead_id',
        leadsRaw.map((l) => l.id as string),
      )
      .order('calculated_at', { ascending: false });
    for (const r of runs ?? []) {
      const lid = r.lead_id as string;
      if (!scoreByLead.has(lid)) {
        scoreByLead.set(lid, {
          score: r.score as number,
          classification: r.classification as string,
        });
      }
    }
  }

  const scoreMin = sp.scoreMin ? Number(sp.scoreMin) : null;
  const scoreMax = sp.scoreMax ? Number(sp.scoreMax) : null;
  let leads = (leadsRaw ?? []).filter((l) => {
    const sc = scoreByLead.get(l.id as string);
    if (sp.classification) {
      const cls = sc?.classification ?? 'unscored';
      if (cls !== sp.classification) return false;
    }
    if (scoreMin !== null && (sc?.score ?? 0) < scoreMin) return false;
    if (scoreMax !== null && (sc?.score ?? 0) > scoreMax) return false;
    return true;
  });
  if (sp.sort === 'score_desc') {
    leads = [...leads].sort(
      (a, b) =>
        (scoreByLead.get(b.id as string)?.score ?? -1) -
        (scoreByLead.get(a.id as string)?.score ?? -1),
    );
  } else if (sp.sort === 'score_asc') {
    leads = [...leads].sort(
      (a, b) =>
        (scoreByLead.get(a.id as string)?.score ?? Infinity) -
        (scoreByLead.get(b.id as string)?.score ?? Infinity),
    );
  }

  const canCreate = ensurePermission(ctx, 'leads.create');
  const canMerge = ensurePermission(ctx, 'leads.merge');
  const canMove = ensurePermission(ctx, 'pipeline.move');
  const canExport = ensurePermission(ctx, 'leads.export');

  const { data: stages } = canMove
    ? await supabase.from('pipeline_stages').select('id, name, sort_order').order('sort_order')
    : { data: [] };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">Leads</h1>
        <div className="flex items-center gap-4 text-sm">
          {canExport ? (
            // Route handler that streams a CSV file (not a page) — a real download link.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/leads/export" download className="text-forest hover:underline">
              Export CSV
            </a>
          ) : null}
          {canMerge ? (
            <Link href="/leads/duplicates" className="text-forest hover:underline">
              Duplicate review →
            </Link>
          ) : null}
        </div>
      </div>

      {canReadScore ? (
        <Panel title="Filter by lead score">
          <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
            {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
            <label className="space-y-1">
              <span className="block text-text-secondary">Classification</span>
              <select
                name="classification"
                defaultValue={sp.classification ?? ''}
                className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-text-primary"
              >
                <option value="">Any</option>
                {CLASSIFICATION_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-text-secondary">Score min</span>
              <input
                name="scoreMin"
                inputMode="numeric"
                defaultValue={sp.scoreMin ?? ''}
                className="w-20 rounded-md border border-border bg-surface-elevated px-2 py-1 text-text-primary"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-text-secondary">Score max</span>
              <input
                name="scoreMax"
                inputMode="numeric"
                defaultValue={sp.scoreMax ?? ''}
                className="w-20 rounded-md border border-border bg-surface-elevated px-2 py-1 text-text-primary"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-text-secondary">Sort</span>
              <select
                name="sort"
                defaultValue={sp.sort ?? ''}
                className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-text-primary"
              >
                <option value="">Newest first</option>
                <option value="score_desc">Score high → low</option>
                <option value="score_asc">Score low → high</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-forest px-3 py-1.5 font-medium text-white hover:bg-forest-deep"
            >
              Apply
            </button>
          </form>
        </Panel>
      ) : null}

      {canCreate ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Add a lead">
            <CreateLeadForm />
          </Panel>
          <Panel title="Import leads (CSV)">
            <ImportLeadsForm />
          </Panel>
        </div>
      ) : null}

      {canMove && leads && leads.length > 0 ? (
        <BulkLeadEditor
          leads={leads.map((l) => ({
            id: l.id as string,
            name: (l.full_name as string | null) ?? 'Unnamed',
          }))}
          stages={(stages ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))}
        />
      ) : null}

      <Panel>
        {!leads || leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            hint="Add a lead, import a CSV, or POST to /forms/:tenant."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Contact</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Stage</th>
                <th className="pb-2 font-medium">Score</th>
                {canReadScore ? <th className="pb-2 font-medium">Lead score</th> : null}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/leads/${l.id}`}
                      className="font-medium text-forest hover:underline"
                    >
                      {l.full_name ?? 'Unnamed lead'}
                    </Link>
                  </td>
                  <td className="py-2 text-text-secondary">
                    {l.primary_phone_national ?? l.primary_email ?? '—'}
                  </td>
                  <td className="py-2 text-text-secondary">
                    {STATUS_LABEL[l.operational_status as string] ?? l.operational_status}
                  </td>
                  <td className="py-2 text-text-secondary">
                    {(l.pipeline_stages as unknown as { name: string } | null)?.name ?? '—'}
                  </td>
                  <td className="py-2 text-text-secondary">{l.score}</td>
                  {canReadScore ? (
                    <td className="py-2 text-text-secondary">
                      {(() => {
                        const sc = scoreByLead.get(l.id as string);
                        return sc ? `${sc.classification.replace('_', ' ')} (${sc.score})` : '—';
                      })()}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
