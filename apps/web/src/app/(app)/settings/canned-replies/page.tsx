import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PermissionDenied } from '@/components/ui/states';
import {
  CannedManage,
  type CannedReplyRow,
  type CategoryRow,
  type ProjectRow,
} from './canned-manage';

export const dynamic = 'force-dynamic';

export default async function CannedRepliesSettingsPage() {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'canned_replies.manage')) {
    return <PermissionDenied />;
  }

  const supabase = await createSupabaseServerClient();

  const [{ data: categories }, { data: replies }, { data: projects }] = await Promise.all([
    supabase
      .from('canned_reply_categories')
      .select('id, name, active')
      .order('name', { ascending: true }),
    supabase
      .from('canned_replies')
      .select('id, title, body, language, channel, project_id, category_id, active, usage_count')
      .order('title', { ascending: true }),
    supabase.from('projects').select('id, name').order('name', { ascending: true }),
  ]);

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    active: Boolean(c.active),
  }));
  const projectRows: ProjectRow[] = (projects ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
  }));
  const replyRows: CannedReplyRow[] = (replies ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    language: (r.language as string | null) ?? null,
    channel: (r.channel as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    active: Boolean(r.active),
    usageCount: (r.usage_count as number | null) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Canned replies</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Reusable reply templates. Variables are resolved on the server when an agent sends a reply
          — only the allowed tokens are substituted.
        </p>
      </div>
      <CannedManage categories={categoryRows} replies={replyRows} projects={projectRows} />
    </div>
  );
}
