import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestModeBanner } from '../ui';
import { CreateConnectionForm } from '../connection-actions';

export const dynamic = 'force-dynamic';

export default async function NewIntegrationPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'integrations.manage')) return <PermissionDenied />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/integrations" className="text-sm text-forest hover:underline">
          ← Integrations
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">New connection</h1>
        <p className="text-sm text-text-secondary">
          Creates a <strong>draft</strong> connection. A connection can never reach a live
          “connected” state in Phase 7A.
        </p>
      </div>

      <TestModeBanner label="TEST MODE — DRAFT ONLY, NOTHING IS CONNECTED" />

      <Panel title="Connection details">
        <CreateConnectionForm />
      </Panel>
    </div>
  );
}
