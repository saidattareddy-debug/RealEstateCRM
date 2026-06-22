import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isStale, summarizeAvailability, type InventoryStatus } from '@re/domain';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { AddUnitForm, StatusSelect, ApproveButton } from './unit-controls';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'projects.read')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const [{ data: project }, { data: settings }] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id, name, developer, category, sale_status, approval_status, locality, price_min, price_max',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('tenant_settings')
      .select('inventory_freshness_hours')
      .eq('tenant_id', ctx.activeTenantId!)
      .maybeSingle(),
  ]);
  if (!project) notFound();

  const freshnessHours = (settings?.inventory_freshness_hours as number) ?? 24;
  const canManage = ensurePermission(ctx, 'projects.manage');
  const canInventory = ensurePermission(ctx, 'inventory.manage');

  // Potentially matching leads (advisory): ONLY leads already visible to the
  // user (RLS scopes this; we do NOT widen visibility). Requires matching.read
  // AND a lead-read permission — a Project Maintenance user (which has neither)
  // never sees private lead data here.
  const canSeeMatchingLeads =
    ensurePermission(ctx, 'matching.read') &&
    (ensurePermission(ctx, 'leads.read.assigned') ||
      ensurePermission(ctx, 'leads.read.team') ||
      ensurePermission(ctx, 'leads.read.all'));

  interface MatchingLeadView {
    candidateId: string;
    leadId: string;
    leadName: string;
    score: number;
    classification: string;
    inventoryState: string;
    budgetOutcome: string;
    preferenceCompleteness: number;
    calculatedAt: string;
    components: string[];
  }
  let matchingLeads: MatchingLeadView[] = [];
  if (canSeeMatchingLeads) {
    // Candidates for THIS project. RLS on lead_match_candidates + leads ensures
    // we only ever see rows for leads the user may see. No conversation content.
    const { data: candRows } = await supabase
      .from('lead_match_candidates')
      .select(
        'id, score, classification, inventory_state, budget_outcome, preference_completeness, eligible, lead_match_runs!inner(lead_id, calculated_at, leads(full_name))',
      )
      .eq('project_id', id)
      .eq('eligible', true)
      .order('score', { ascending: false })
      .limit(20);
    const rows = (candRows ?? []) as unknown as {
      id: string;
      score: number;
      classification: string;
      inventory_state: string;
      budget_outcome: string;
      preference_completeness: number;
      lead_match_runs: {
        lead_id: string;
        calculated_at: string;
        leads: { full_name: string | null } | null;
      } | null;
    }[];
    // Keep only the best candidate per lead (a lead may have multiple levels).
    const byLead = new Map<string, MatchingLeadView>();
    const candidateIds: string[] = [];
    for (const r of rows) {
      const run = r.lead_match_runs;
      if (!run?.lead_id) continue;
      const existing = byLead.get(run.lead_id);
      if (existing && existing.score >= r.score) continue;
      byLead.set(run.lead_id, {
        candidateId: r.id,
        leadId: run.lead_id,
        leadName: run.leads?.full_name ?? 'Lead',
        score: r.score,
        classification: r.classification,
        inventoryState: r.inventory_state,
        budgetOutcome: r.budget_outcome,
        preferenceCompleteness: Number(r.preference_completeness),
        calculatedAt: run.calculated_at,
        components: [],
      });
    }
    matchingLeads = Array.from(byLead.values()).sort((a, b) => b.score - a.score);
    for (const v of matchingLeads) candidateIds.push(v.candidateId);
    if (candidateIds.length > 0) {
      const { data: compRows } = await supabase
        .from('lead_match_components')
        .select('candidate_id, signal_key, contribution, positive')
        .in('candidate_id', candidateIds);
      const byCand = new Map<string, string[]>();
      for (const c of (compRows ?? []) as {
        candidate_id: string;
        signal_key: string;
        contribution: number;
        positive: boolean;
      }[]) {
        if (!c.positive || Number(c.contribution) <= 0) continue;
        const arr = byCand.get(c.candidate_id) ?? [];
        arr.push(`${c.signal_key} (+${Number(c.contribution)})`);
        byCand.set(c.candidate_id, arr);
      }
      for (const v of matchingLeads) v.components = (byCand.get(v.candidateId) ?? []).slice(0, 4);
    }
  }

  const [{ data: configs }, { data: units }] = await Promise.all([
    supabase
      .from('project_configurations')
      .select('id, label, carpet_area_sqft, base_price')
      .eq('project_id', id),
    supabase
      .from('inventory_units')
      .select('id, unit_number, status, price, last_verified_at')
      .eq('project_id', id)
      .order('unit_number'),
  ]);

  const unitRows = (units ?? []) as {
    id: string;
    unit_number: string;
    status: InventoryStatus;
    price: number | null;
    last_verified_at: string;
  }[];
  const summary = summarizeAvailability(
    unitRows.map((u) => ({ status: u.status, lastVerifiedAt: u.last_verified_at })),
    freshnessHours,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{project.name}</h1>
          <p className="text-sm capitalize text-text-secondary">
            {project.category} · {project.locality ?? '—'} · {project.approval_status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Link
              href={`/projects/${project.id}/edit`}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-elevated"
            >
              Edit
            </Link>
          ) : null}
          {canManage && project.approval_status !== 'approved' ? (
            <ApproveButton projectId={project.id as string} />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Units" value={summary.total} />
        <StatCard label="Available" value={summary.available} />
        <StatCard label="Offerable (fresh)" value={summary.offerable} />
        <StatCard label="Stale" value={summary.stale} hint={`> ${freshnessHours}h unverified`} />
      </div>

      <Panel title="Configurations">
        {!configs || configs.length === 0 ? (
          <EmptyState title="No configurations" />
        ) : (
          <ul className="space-y-1 text-sm">
            {configs.map((c) => (
              <li
                key={c.id}
                className="flex justify-between border-b border-border/50 py-1 last:border-0"
              >
                <span className="text-text-primary">{c.label}</span>
                <span className="text-text-secondary">
                  {c.carpet_area_sqft ? `${c.carpet_area_sqft} sqft` : ''}
                  {c.base_price ? ` · ₹${Number(c.base_price).toLocaleString('en-IN')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canInventory ? (
        <Panel title="Add unit">
          <AddUnitForm projectId={project.id as string} />
        </Panel>
      ) : null}

      <Panel title="Inventory">
        {unitRows.length === 0 ? (
          <EmptyState title="No units yet" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Unit</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Price</th>
                <th className="pb-2 font-medium">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((u) => {
                const stale =
                  u.status === 'available' && isStale(u.last_verified_at, freshnessHours);
                return (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 font-medium text-text-primary">{u.unit_number}</td>
                    <td className="py-2">
                      {canInventory ? (
                        <StatusSelect unitId={u.id} value={u.status} />
                      ) : (
                        <span className="capitalize text-text-secondary">
                          {u.status.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-text-secondary">
                      {u.price ? `₹${Number(u.price).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-2">
                      {stale ? (
                        <span className="rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
                          Stale
                        </span>
                      ) : (
                        <span className="text-xs text-text-secondary">Fresh</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {canSeeMatchingLeads ? (
        <Panel title="Potentially matching leads (advisory)">
          <p className="mb-3 text-xs text-text-secondary">
            Advisory recommendations only — derived from each lead’s most recent match calculation.
            Listing a lead here never assigns it, changes its stage/status/score, reserves inventory
            or sends anything. Only leads you already have access to are shown.
          </p>
          {matchingLeads.length === 0 ? (
            <EmptyState
              title="No matching leads yet"
              hint="Leads appear here after their matches are calculated against this project."
            />
          ) : (
            <ul className="space-y-2">
              {matchingLeads.map((m) => (
                <li
                  key={m.candidateId}
                  className="flex flex-col gap-1 border-b border-border/50 py-2 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/leads/${m.leadId}`}
                      className="font-medium text-forest hover:underline"
                    >
                      {m.leadName}
                    </Link>
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                      {m.classification.replace('_', ' ')}
                    </span>
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                      score {m.score}
                    </span>
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                      completeness {(m.preferenceCompleteness * 100).toFixed(0)}%
                    </span>
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                      inventory: {m.inventoryState.replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                      budget: {m.budgetOutcome.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {m.components.length > 0 ? (
                    <p className="text-xs text-text-secondary">Fit: {m.components.join(', ')}</p>
                  ) : null}
                  <p className="text-xs text-text-secondary">
                    Last calculated {new Date(m.calculatedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
