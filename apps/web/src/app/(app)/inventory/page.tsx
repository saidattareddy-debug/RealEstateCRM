import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isStale, summarizeAvailability, type InventoryStatus } from '@re/domain';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import { ReverifyButton } from './stale-controls';
import { BulkEditor } from './bulk-editor';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ stale?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'inventory.read')) return <PermissionDenied />;
  const sp = await searchParams;
  const onlyStale = sp.stale === '1';

  const supabase = await createSupabaseServerClient();
  const [{ data: settings }, { data: units }] = await Promise.all([
    supabase
      .from('tenant_settings')
      .select('inventory_freshness_hours')
      .eq('tenant_id', ctx.activeTenantId!)
      .maybeSingle(),
    supabase
      .from('inventory_units')
      .select('id, unit_number, status, price, last_verified_at, projects(name)')
      .order('unit_number'),
  ]);

  const freshnessHours = (settings?.inventory_freshness_hours as number) ?? 24;
  const allRows = (units ?? []).map((u) => ({
    id: u.id as string,
    unit_number: u.unit_number as string,
    status: u.status as InventoryStatus,
    price: (u.price as number | null) ?? null,
    last_verified_at: u.last_verified_at as string,
    project: (u.projects as unknown as { name: string } | null)?.name ?? '—',
  }));
  const summary = summarizeAvailability(
    allRows.map((u) => ({ status: u.status, lastVerifiedAt: u.last_verified_at })),
    freshnessHours,
  );
  const canResolve = ensurePermission(ctx, 'staledata.resolve');
  const canManageInv = ensurePermission(ctx, 'inventory.manage');

  const rows = onlyStale
    ? allRows.filter((u) => u.status === 'available' && isStale(u.last_verified_at, freshnessHours))
    : allRows;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">Inventory</h1>
        {ensurePermission(ctx, 'inventory.import') ? (
          <Link
            href="/inventory/import"
            className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep"
          >
            Import CSV
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Units" value={summary.total} />
        <StatCard label="Available" value={summary.available} />
        <StatCard label="Offerable (fresh)" value={summary.offerable} />
        <StatCard label="Stale" value={summary.stale} hint={`> ${freshnessHours}h unverified`} />
      </div>

      <div className="flex gap-2 text-sm">
        <Link
          href="/inventory"
          className={`rounded-md px-3 py-1 ${!onlyStale ? 'bg-forest text-white' : 'text-text-secondary hover:bg-surface-elevated'}`}
        >
          All units
        </Link>
        <Link
          href="/inventory?stale=1"
          className={`rounded-md px-3 py-1 ${onlyStale ? 'bg-forest text-white' : 'text-text-secondary hover:bg-surface-elevated'}`}
        >
          Stale-data report ({summary.stale})
        </Link>
      </div>

      {canManageInv && !onlyStale ? (
        <BulkEditor
          units={allRows.map((u) => ({
            id: u.id,
            unit_number: u.unit_number,
            project: u.project,
            status: u.status,
          }))}
        />
      ) : null}

      <Panel>
        {rows.length === 0 ? (
          <EmptyState title={onlyStale ? 'No stale units' : 'No inventory yet'} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Unit</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Price</th>
                <th className="pb-2 font-medium">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const stale =
                  u.status === 'available' && isStale(u.last_verified_at, freshnessHours);
                return (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 text-text-secondary">{u.project}</td>
                    <td className="py-2 font-medium text-text-primary">{u.unit_number}</td>
                    <td className="py-2 capitalize text-text-secondary">
                      {u.status.replace('_', ' ')}
                    </td>
                    <td className="py-2 text-text-secondary">
                      {u.price ? `₹${Number(u.price).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-2">
                      {stale ? (
                        <span className="flex items-center gap-2">
                          <span className="rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
                            Stale
                          </span>
                          {canResolve ? <ReverifyButton unitId={u.id} /> : null}
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
    </div>
  );
}
