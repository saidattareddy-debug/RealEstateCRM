'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { updateUsageLimits, type UpdateUsageInput } from '../actions';

export interface UsageLimitsRow {
  daily_token_limit: number;
  monthly_token_limit: number;
  per_conversation_token_limit: number;
  per_request_input_limit: number;
  per_request_output_limit: number;
  retrieval_result_limit: number;
  tool_call_limit: number;
  max_retries: number;
}

const DEFAULTS: UsageLimitsRow = {
  daily_token_limit: 200000,
  monthly_token_limit: 4000000,
  per_conversation_token_limit: 20000,
  per_request_input_limit: 8000,
  per_request_output_limit: 1500,
  retrieval_result_limit: 8,
  tool_call_limit: 4,
  max_retries: 2,
};

const input =
  'mt-1 w-40 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60';

export function UsageLimitsForm({ limits }: { limits: UsageLimitsRow | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = limits ?? DEFAULTS;

  const [values, setValues] = useState<Record<keyof UsageLimitsRow, string>>({
    daily_token_limit: String(base.daily_token_limit),
    monthly_token_limit: String(base.monthly_token_limit),
    per_conversation_token_limit: String(base.per_conversation_token_limit),
    per_request_input_limit: String(base.per_request_input_limit),
    per_request_output_limit: String(base.per_request_output_limit),
    retrieval_result_limit: String(base.retrieval_result_limit),
    tool_call_limit: String(base.tool_call_limit),
    max_retries: String(base.max_retries),
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function set(key: keyof UsageLimitsRow, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const payload: UpdateUsageInput = {
      dailyTokenLimit: Number(values.daily_token_limit),
      monthlyTokenLimit: Number(values.monthly_token_limit),
      perConversationTokenLimit: Number(values.per_conversation_token_limit),
      perRequestInputLimit: Number(values.per_request_input_limit),
      perRequestOutputLimit: Number(values.per_request_output_limit),
      retrievalResultLimit: Number(values.retrieval_result_limit),
      toolCallLimit: Number(values.tool_call_limit),
      maxRetries: Number(values.max_retries),
    };
    start(async () => {
      const res = await updateUsageLimits(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Daily token limit"
          k="daily_token_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Monthly token limit"
          k="monthly_token_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Per-conversation token limit"
          k="per_conversation_token_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Per-request input limit"
          k="per_request_input_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Per-request output limit"
          k="per_request_output_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Retrieval result limit"
          k="retrieval_result_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field
          label="Tool-call limit"
          k="tool_call_limit"
          values={values}
          set={set}
          disabled={pending}
        />
        <Field label="Max retries" k="max_retries" values={values} set={set} disabled={pending} />
      </div>
      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Usage limits updated.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save usage limits'}
      </button>
    </form>
  );
}

function Field({
  label,
  k,
  values,
  set,
  disabled,
}: {
  label: string;
  k: keyof UsageLimitsRow;
  values: Record<keyof UsageLimitsRow, string>;
  set: (k: keyof UsageLimitsRow, v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        type="number"
        min={0}
        value={values[k]}
        onChange={(e) => set(k, e.target.value)}
        disabled={disabled}
        className={cn(input)}
      />
    </label>
  );
}
