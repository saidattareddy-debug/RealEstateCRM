import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { PromptManager, type PromptRow, type PromptVersionRow } from './prompts-manage';

export const dynamic = 'force-dynamic';

export default async function AiPromptsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }
  const canManage = ensurePermission(ctx, 'ai.prompts.manage');

  const supabase = await createSupabaseServerClient();
  const [{ data: promptData }, { data: versionData }] = await Promise.all([
    supabase
      .from('ai_prompts')
      .select('id, key, description')
      .eq('tenant_id', ctx.activeTenantId!)
      .order('key', { ascending: true }),
    supabase
      .from('ai_prompt_versions')
      .select('id, prompt_id, version, change_summary, active')
      .eq('tenant_id', ctx.activeTenantId!)
      .order('version', { ascending: false }),
  ]);

  const versions = (versionData ?? []) as (PromptVersionRow & { prompt_id: string })[];
  const prompts: PromptRow[] = (
    (promptData ?? []) as { id: string; key: string; description: string | null }[]
  ).map((p) => ({
    id: p.id,
    key: p.key,
    description: p.description,
    versions: versions
      .filter((v) => v.prompt_id === p.id)
      .map(({ id, version, change_summary, active }) => ({ id, version, change_summary, active })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/ai" className="text-xs text-text-secondary hover:text-text-primary">
          ← AI settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-text-primary">AI prompts</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage versioned prompts. Drafting a new version never makes it live — you activate a
          version explicitly. Only one version of a prompt is active at a time.
        </p>
      </div>

      <Panel title="Prompts">
        {canManage ? <PromptManager prompts={prompts} /> : <ReadOnlyPrompts prompts={prompts} />}
      </Panel>
    </div>
  );
}

function ReadOnlyPrompts({ prompts }: { prompts: PromptRow[] }) {
  if (prompts.length === 0) {
    return <p className="text-sm text-text-secondary">No prompts configured yet.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        You can view but not change AI prompts (requires the AI prompts-manage permission).
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {prompts.map((p) => {
          const active = p.versions.find((v) => v.active);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="font-mono font-medium text-text-primary">{p.key}</span>
              {p.description ? (
                <span className="text-xs text-text-secondary">{p.description}</span>
              ) : null}
              <span className="ml-auto text-xs text-text-secondary">
                {active ? `active v${active.version}` : 'no active version'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
