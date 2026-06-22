import { getAppContext, ensurePermission } from '@/lib/auth';
import { listAuditLogs, type AuditFilters } from '@/lib/audit/audit-query';
import { AUDIT_CATEGORIES, type AuditCategory } from '@re/validation';
import { PermissionDenied } from '@/components/ui/states';
import { AuditClient } from './audit-client';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'settings.audit.read')) {
    return <PermissionDenied message="Audit logs require the audit-read permission." />;
  }

  const sp = await searchParams;
  const filters: AuditFilters = {
    action: sp.action || undefined,
    category: (sp.category as AuditCategory) || undefined,
    entityType: sp.entityType || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };

  const rows = await listAuditLogs(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Audit log</h1>
        <p className="text-sm text-text-secondary">
          Immutable record of security-sensitive actions in this workspace.
        </p>
      </div>
      <AuditClient
        rows={rows}
        categories={[...AUDIT_CATEGORIES]}
        current={{
          action: filters.action ?? '',
          category: filters.category ?? '',
          entityType: filters.entityType ?? '',
          from: filters.from ?? '',
          to: filters.to ?? '',
        }}
      />
    </div>
  );
}
