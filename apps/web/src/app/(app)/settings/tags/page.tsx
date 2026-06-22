import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { TagManager, type ManagedTag } from './tag-manage';

export const dynamic = 'force-dynamic';

export default async function TagsSettingsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'conversations.tags.manage')) {
    return <PermissionDenied />;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('conversation_tags')
    .select('id, name, color_token, active')
    .eq('tenant_id', ctx.activeTenantId!)
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  const tags = (data as ManagedTag[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Conversation tags</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Create and organise the tags used to label conversations. Disabled tags stay on the
          conversations they are already on, but cannot be newly assigned.
        </p>
      </div>

      <Panel title="Tags">
        <TagManager tags={tags} />
      </Panel>
    </div>
  );
}
