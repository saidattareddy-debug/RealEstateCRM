import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { NewSourceForm } from './new-source-form';

export const dynamic = 'force-dynamic';

export default async function NewKnowledgeSourcePage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'knowledge.create')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: projectsData } = await supabase
    .from('projects')
    .select('id, name')
    .eq('tenant_id', ctx.activeTenantId!)
    .order('name', { ascending: true });
  const projects = (projectsData as { id: string; name: string }[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-forest hover:underline">
          ← Back to knowledge
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">New knowledge source</h1>
        <p className="mt-1 text-sm text-text-secondary">
          New sources land in review and are never auto-approved. Content is treated as untrusted
          and scanned before it can be approved for grounding.
        </p>
      </div>

      <Panel>
        <NewSourceForm projects={projects} />
      </Panel>
    </div>
  );
}
