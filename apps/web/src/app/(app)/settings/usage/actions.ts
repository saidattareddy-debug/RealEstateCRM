'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { upsertBillingPeriod } from '@/lib/analytics/billing-service';

export interface BillingActionState {
  ok?: boolean;
  error?: string;
}

const schema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date.'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid end date.'),
  planTier: z.enum(['starter', 'growth', 'enterprise']),
  status: z.enum(['open', 'closed', 'invoiced']),
  currency: z.string().trim().min(1).max(8),
  amountDue: z.coerce.number().min(0).max(1_000_000_000),
});

/** Update (or create) the billing period for the caller's tenant. */
export async function updateBillingPeriodAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId) return { error: 'No active tenant.' };
  if (!ensurePermission(ctx, 'billing.manage'))
    return { error: 'You do not have permission to manage billing.' };

  const parsed = schema.safeParse({
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    planTier: formData.get('planTier'),
    status: formData.get('status'),
    currency: formData.get('currency'),
    amountDue: formData.get('amountDue'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  if (parsed.data.periodEnd < parsed.data.periodStart)
    return { error: 'Period end must not precede period start.' };

  const supabase = await createSupabaseServerClient();
  const res = await upsertBillingPeriod(supabase, {
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    periodStart: parsed.data.periodStart,
    periodEnd: parsed.data.periodEnd,
    planTier: parsed.data.planTier,
    status: parsed.data.status,
    currency: parsed.data.currency,
    amountDue: parsed.data.amountDue,
  });
  revalidatePath('/settings/usage');
  return res.ok ? { ok: true } : { error: res.error };
}
