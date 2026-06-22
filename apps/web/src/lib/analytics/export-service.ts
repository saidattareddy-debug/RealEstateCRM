import 'server-only';
import { writeAudit } from '@/lib/audit/audit-service';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface RecordExportInput {
  tenantId: string;
  actorUserId: string;
  /** Logical report name, e.g. 'analytics_overview', 'team_performance'. */
  report: string;
  format: 'csv' | 'json';
  rowCount: number;
  /** Non-PII filter context (date ranges, scope flags). Stored as jsonb. */
  filters?: Record<string, unknown>;
}

/**
 * Record an analytics/report export as an auditable data egress (MASTER_SPEC §28).
 * Writes one `analytics_export_logs` row under the caller's RLS (the table's
 * insert policy requires `analytics.export`) AND an `ANALYTICS_EXPORTED` audit
 * entry. The log row never throws into the export's critical path.
 */
export async function recordExport(supabase: DB, input: RecordExportInput): Promise<void> {
  try {
    await supabase.from('analytics_export_logs').insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      report: input.report,
      format: input.format,
      row_count: input.rowCount,
      filters: input.filters ?? {},
    });
  } catch (e) {
    console.error('[analytics] failed to write export log', (e as Error).message);
  }

  await writeAudit({
    action: 'ANALYTICS_EXPORTED',
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: 'analytics_export',
    newValues: {
      report: input.report,
      format: input.format,
      rowCount: input.rowCount,
      filters: input.filters ?? {},
    },
  });
}

// ---------------------------------------------------------------------------
// Formula-injection-safe CSV helpers (mirrors leads/export precedent)
// ---------------------------------------------------------------------------

/**
 * Escape a CSV cell and neutralise spreadsheet formula injection by prefixing
 * values that begin with = + - @ (or tab/CR) with an apostrophe.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV body from a header row + data rows, each cell escaped. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\n');
}
