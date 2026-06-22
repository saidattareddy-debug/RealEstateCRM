import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { PolicyManager, type PolicyRow, type ProjectOption } from './policies-manage';

export const dynamic = 'force-dynamic';

const POLICY_SELECT =
  'id, project_id, operating_level, general_answers_enabled, english_fallback_allowed, shadow_sample_rate, copilot_enabled, language_policy, escalation_policy';

export default async function AiPoliciesPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }
  const canManage = ensurePermission(ctx, 'ai.settings.manage');

  const supabase = await createSupabaseServerClient();
  const [{ data: policyData }, { data: projectData }] = await Promise.all([
    supabase.from('ai_feature_policies').select(POLICY_SELECT).eq('tenant_id', ctx.activeTenantId!),
    supabase.from('projects').select('id, name').order('name', { ascending: true }),
  ]);

  const policies = (policyData as PolicyRow[] | null) ?? [];
  const tenantPolicy = policies.find((p) => p.project_id === null) ?? null;
  const projectPolicies = policies.filter((p) => p.project_id !== null);
  const projects = (projectData as ProjectOption[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/ai" className="text-xs text-text-secondary hover:text-text-primary">
          ← AI settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-text-primary">AI policies</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Set the tenant default policy and optional per-project overrides: operating level,
          general-answer policy, language and escalation policy, shadow sampling and copilot
          enablement. The AI never sends a customer message in this phase.
        </p>
      </div>

      <Panel title="Policies">
        {canManage ? (
          <PolicyManager
            tenantPolicy={tenantPolicy}
            projectPolicies={projectPolicies}
            projects={projects}
          />
        ) : (
          <ReadOnlyPolicies
            tenantPolicy={tenantPolicy}
            projectPolicies={projectPolicies}
            projects={projects}
          />
        )}
      </Panel>
    </div>
  );
}

function ReadOnlyPolicies({
  tenantPolicy,
  projectPolicies,
  projects,
}: {
  tenantPolicy: PolicyRow | null;
  projectPolicies: PolicyRow[];
  projects: ProjectOption[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        You can view but not change AI policies (requires the AI settings-manage permission).
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        <PolicyLine label="Tenant default" policy={tenantPolicy} />
        {projectPolicies.map((p) => (
          <PolicyLine
            key={p.id}
            label={projects.find((pr) => pr.id === p.project_id)?.name ?? 'Project'}
            policy={p}
          />
        ))}
      </ul>
    </div>
  );
}

function PolicyLine({ label, policy }: { label: string; policy: PolicyRow | null }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <span className="font-medium text-text-primary">{label}</span>
      <span className="ml-auto text-xs text-text-secondary">
        {policy ? `level: ${policy.operating_level}` : 'uses tenant default (disabled)'}
      </span>
    </li>
  );
}
