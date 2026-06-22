import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { UsageLimitsForm, type UsageLimitsRow } from './usage-manage';

export const dynamic = 'force-dynamic';

const USAGE_SELECT =
  'daily_token_limit, monthly_token_limit, per_conversation_token_limit, per_request_input_limit, per_request_output_limit, retrieval_result_limit, tool_call_limit, max_retries';

export default async function AiUsagePage() {
  const ctx = await getAppContext();
  // View needs ai.usage.read (ai.settings.read also satisfies RLS); editing needs ai.settings.manage.
  if (!ensurePermission(ctx, 'ai.usage.read') && !ensurePermission(ctx, 'ai.settings.read')) {
    return <PermissionDenied />;
  }
  const canManage = ensurePermission(ctx, 'ai.settings.manage');

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_usage_limits')
    .select(USAGE_SELECT)
    .eq('tenant_id', ctx.activeTenantId!)
    .maybeSingle();

  const limits = (data as UsageLimitsRow | null) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/ai" className="text-xs text-text-secondary hover:text-text-primary">
          ← AI settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-text-primary">AI usage limits</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Token, retrieval, tool-call and retry budgets for this workspace. These caps bound AI
          spend and runtime behaviour.
        </p>
      </div>

      <Panel title="Current limits">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Daily tokens"
            value={limits ? limits.daily_token_limit.toLocaleString() : '—'}
          />
          <StatCard
            label="Monthly tokens"
            value={limits ? limits.monthly_token_limit.toLocaleString() : '—'}
          />
          <StatCard
            label="Per-conversation"
            value={limits ? limits.per_conversation_token_limit.toLocaleString() : '—'}
          />
          <StatCard label="Max retries" value={limits ? limits.max_retries : '—'} />
        </div>
        {!limits ? (
          <p className="mt-3 text-xs text-text-secondary">
            No usage-limit row yet — defaults apply until saved.
          </p>
        ) : null}
      </Panel>

      <Panel title="Edit limits">
        {canManage ? (
          <UsageLimitsForm limits={limits} />
        ) : (
          <p className="text-sm text-text-secondary">
            You can view but not change usage limits (requires the AI settings-manage permission).
          </p>
        )}
      </Panel>
    </div>
  );
}
