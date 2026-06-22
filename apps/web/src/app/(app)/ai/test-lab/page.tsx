import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TestLabClient } from './test-lab-client';

export const dynamic = 'force-dynamic';

export default async function AiTestLabPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.test_lab.use')) return <PermissionDenied />;

  // Projects are RLS-scoped by the server client; we never trust a client tenant id.
  const supabase = await createSupabaseServerClient();
  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(200);
  const projects = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string | null) ?? 'Untitled project',
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">AI Test Lab</h1>
        <p className="text-sm text-text-secondary">
          Dry-run the AI answer orchestrator against approved knowledge and structured project data.
          Inspect retrieval, grounding, escalation and the agent-facing draft — nothing here is ever
          sent to a customer or changes any conversation or lead.
        </p>
      </div>

      <Panel title="Test a question">
        <TestLabClient projects={projects} />
      </Panel>
    </div>
  );
}
