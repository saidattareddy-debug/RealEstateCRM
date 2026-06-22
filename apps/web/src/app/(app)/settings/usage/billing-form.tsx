'use client';

import { useActionState } from 'react';
import { updateBillingPeriodAction, type BillingActionState } from './actions';

const initial: BillingActionState = {};

const field =
  'rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary';

export function BillingPeriodForm({
  defaults,
}: {
  defaults: {
    periodStart: string;
    periodEnd: string;
    planTier: string;
    status: string;
    currency: string;
    amountDue: number;
  };
}) {
  const [state, action, pending] = useActionState(updateBillingPeriodAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Period start</span>
        <input
          type="date"
          name="periodStart"
          defaultValue={defaults.periodStart}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Period end</span>
        <input type="date" name="periodEnd" defaultValue={defaults.periodEnd} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Plan tier</span>
        <select name="planTier" defaultValue={defaults.planTier} className={field}>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Status</span>
        <select name="status" defaultValue={defaults.status} className={field}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="invoiced">Invoiced</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Currency</span>
        <input name="currency" defaultValue={defaults.currency} maxLength={8} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Amount due</span>
        <input
          type="number"
          name="amountDue"
          min={0}
          step="0.01"
          defaultValue={defaults.amountDue}
          className={field}
        />
      </label>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save billing period'}
        </button>
        {state.error && <p className="text-sm text-terracotta">{state.error}</p>}
        {state.ok && <p className="text-sm text-success">Billing period saved.</p>}
      </div>
    </form>
  );
}
