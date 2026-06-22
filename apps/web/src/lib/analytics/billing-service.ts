import 'server-only';
import { writeAudit } from '@/lib/audit/audit-service';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface UpsertBillingPeriodInput {
  tenantId: string;
  actorUserId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  planTier: 'starter' | 'growth' | 'enterprise';
  status: 'open' | 'closed' | 'invoiced';
  currency: string;
  amountDue: number;
}

export type BillingResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Create or update the billing period covering [periodStart, periodEnd] for the
 * caller's tenant. The table's RLS write policy requires `billing.manage`; we do
 * NOT trust a client-supplied tenant_id — it is taken from the server context.
 * Writes a `BILLING_PERIOD_UPDATED` audit entry on success.
 */
export async function upsertBillingPeriod(
  supabase: DB,
  input: UpsertBillingPeriodInput,
): Promise<BillingResult> {
  try {
    // Find an existing period with the same window for this tenant.
    const { data: existing } = await supabase
      .from('billing_periods')
      .select('id, plan_tier, status, currency, amount_due')
      .eq('tenant_id', input.tenantId)
      .eq('period_start', input.periodStart)
      .eq('period_end', input.periodEnd)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('billing_periods')
        .update({
          plan_tier: input.planTier,
          status: input.status,
          currency: input.currency,
          amount_due: input.amountDue,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id as string);
      if (error) return { ok: false, error: error.message };

      await writeAudit({
        action: 'BILLING_PERIOD_UPDATED',
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        entityType: 'billing_period',
        entityId: existing.id as string,
        previousValues: {
          planTier: existing.plan_tier,
          status: existing.status,
          currency: existing.currency,
          amountDue: Number(existing.amount_due ?? 0),
        },
        newValues: {
          planTier: input.planTier,
          status: input.status,
          currency: input.currency,
          amountDue: input.amountDue,
        },
      });
      return { ok: true, id: existing.id as string };
    }

    const { data: inserted, error } = await supabase
      .from('billing_periods')
      .insert({
        tenant_id: input.tenantId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        plan_tier: input.planTier,
        status: input.status,
        currency: input.currency,
        amount_due: input.amountDue,
      })
      .select('id')
      .single();
    if (error || !inserted) return { ok: false, error: error?.message ?? 'Insert failed.' };

    await writeAudit({
      action: 'BILLING_PERIOD_UPDATED',
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: 'billing_period',
      entityId: inserted.id as string,
      newValues: {
        planTier: input.planTier,
        status: input.status,
        currency: input.currency,
        amountDue: input.amountDue,
      },
    });
    return { ok: true, id: inserted.id as string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
