import 'server-only';
import { AUDIT_ACTION_LIST, type AuditCategory } from '@re/validation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** RLS-enforced read service for the admin audit-log page. */

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  previous_values: unknown;
  new_values: unknown;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface AuditFilters {
  action?: string;
  category?: AuditCategory;
  actorUserId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function listAuditLogs(filters: AuditFilters = {}): Promise<AuditLogRow[]> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 100, 500));

  if (filters.action) q = q.eq('action', filters.action);
  if (filters.category) {
    const keys = AUDIT_ACTION_LIST.filter((a) => a.category === filters.category).map((a) => a.key);
    q = q.in('action', keys.length ? keys : ['__none__']);
  }
  if (filters.actorUserId) q = q.eq('actor_user_id', filters.actorUserId);
  if (filters.entityType) q = q.eq('entity_type', filters.entityType);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lte('created_at', filters.to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLogRow[];
}
