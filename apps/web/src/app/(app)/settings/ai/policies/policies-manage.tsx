'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@re/ui';
import { upsertFeaturePolicy, type UpsertPolicyInput } from '../actions';

export interface PolicyRow {
  id: string;
  project_id: string | null;
  operating_level: 'disabled' | 'shadow' | 'copilot' | 'automatic';
  general_answers_enabled: boolean;
  english_fallback_allowed: boolean;
  shadow_sample_rate: number;
  copilot_enabled: boolean;
  language_policy: Record<string, unknown>;
  escalation_policy: Record<string, unknown>;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const OPERATING_LEVELS = ['disabled', 'shadow', 'copilot', 'automatic'] as const;

const input =
  'mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary disabled:opacity-60';

const EMPTY_POLICY: Omit<PolicyRow, 'id' | 'project_id'> = {
  operating_level: 'disabled',
  general_answers_enabled: false,
  english_fallback_allowed: true,
  shadow_sample_rate: 0,
  copilot_enabled: false,
  language_policy: {},
  escalation_policy: {},
};

export function PolicyManager({
  tenantPolicy,
  projectPolicies,
  projects,
}: {
  tenantPolicy: PolicyRow | null;
  projectPolicies: PolicyRow[];
  projects: ProjectOption[];
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Tenant default policy</h3>
        <PolicyForm scope="tenant" projectId={null} policy={tenantPolicy} projects={projects} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Per-project policies</h3>
        {projectPolicies.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No project-specific policies yet. Add one below — projects without an explicit policy
            use the tenant default.
          </p>
        ) : (
          <ul className="space-y-4">
            {projectPolicies.map((p) => (
              <li key={p.id}>
                <p className="mb-1 text-xs font-medium text-text-secondary">
                  {projects.find((pr) => pr.id === p.project_id)?.name ?? 'Project'}
                </p>
                <PolicyForm
                  scope="project"
                  projectId={p.project_id}
                  policy={p}
                  projects={projects}
                />
              </li>
            ))}
          </ul>
        )}
        <AddProjectPolicy projectPolicies={projectPolicies} projects={projects} />
      </div>
    </div>
  );
}

function AddProjectPolicy({
  projectPolicies,
  projects,
}: {
  projectPolicies: PolicyRow[];
  projects: ProjectOption[];
}) {
  const configured = new Set(projectPolicies.map((p) => p.project_id));
  const available = projects.filter((p) => !configured.has(p.id));
  const [selected, setSelected] = useState<string>('');

  if (available.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <label className="flex flex-col text-xs text-text-secondary">
        Add a policy for a project
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={cn(input, 'w-64')}
        >
          <option value="">Select a project…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <PolicyForm scope="project" projectId={selected} policy={null} projects={projects} />
      ) : null}
    </div>
  );
}

function PolicyForm({
  scope,
  projectId,
  policy,
  projects,
}: {
  scope: 'tenant' | 'project';
  projectId: string | null;
  policy: PolicyRow | null;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = policy ?? { ...EMPTY_POLICY, id: '', project_id: projectId };

  const [operatingLevel, setOperatingLevel] = useState(base.operating_level);
  const [generalAnswers, setGeneralAnswers] = useState(base.general_answers_enabled);
  const [englishFallback, setEnglishFallback] = useState(base.english_fallback_allowed);
  const [shadowRate, setShadowRate] = useState(String(base.shadow_sample_rate));
  const [copilotEnabled, setCopilotEnabled] = useState(base.copilot_enabled);
  const [languageJson, setLanguageJson] = useState(
    JSON.stringify(base.language_policy ?? {}, null, 2),
  );
  const [escalationJson, setEscalationJson] = useState(
    JSON.stringify(base.escalation_policy ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? null,
    [projects, projectId],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    let languagePolicy: Record<string, unknown>;
    let escalationPolicy: Record<string, unknown>;
    try {
      languagePolicy = languageJson.trim() ? JSON.parse(languageJson) : {};
      escalationPolicy = escalationJson.trim() ? JSON.parse(escalationJson) : {};
    } catch {
      setError('Language and escalation policy must be valid JSON objects.');
      return;
    }
    if (typeof languagePolicy !== 'object' || Array.isArray(languagePolicy)) {
      setError('Language policy must be a JSON object.');
      return;
    }
    if (typeof escalationPolicy !== 'object' || Array.isArray(escalationPolicy)) {
      setError('Escalation policy must be a JSON object.');
      return;
    }

    const payload: UpsertPolicyInput = {
      projectId: scope === 'project' ? projectId : null,
      operatingLevel,
      generalAnswersEnabled: generalAnswers,
      englishFallbackAllowed: englishFallback,
      shadowSampleRate: Number(shadowRate),
      copilotEnabled,
      languagePolicy,
      escalationPolicy,
    };
    start(async () => {
      const res = await upsertFeaturePolicy(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-surface-elevated p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-secondary">
          Operating level
          <select
            value={operatingLevel}
            onChange={(e) => setOperatingLevel(e.target.value as PolicyRow['operating_level'])}
            disabled={pending}
            className={cn(input, 'w-44')}
          >
            {OPERATING_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Shadow sample rate (0–1)
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={shadowRate}
            onChange={(e) => setShadowRate(e.target.value)}
            disabled={pending}
            className={cn(input, 'w-32')}
          />
        </label>
      </div>

      {operatingLevel === 'automatic' ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-text-primary">
          Note: automatic answering is NOT enabled in Phase 5A. This level is stored, but the
          runtime denies automatic sending — no customer message is ever sent automatically.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <Toggle
          label="General answers enabled"
          checked={generalAnswers}
          onChange={setGeneralAnswers}
          disabled={pending}
        />
        <Toggle
          label="Copilot drafts enabled"
          checked={copilotEnabled}
          onChange={setCopilotEnabled}
          disabled={pending}
        />
        <Toggle
          label="English fallback allowed"
          checked={englishFallback}
          onChange={setEnglishFallback}
          disabled={pending}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-xs text-text-secondary">
          Language policy (JSON)
          <textarea
            value={languageJson}
            onChange={(e) => setLanguageJson(e.target.value)}
            rows={4}
            disabled={pending}
            className={cn(input, 'w-full font-mono')}
          />
        </label>
        <label className="flex flex-col text-xs text-text-secondary">
          Escalation policy (JSON)
          <textarea
            value={escalationJson}
            onChange={(e) => setEscalationJson(e.target.value)}
            rows={4}
            disabled={pending}
            className={cn(input, 'w-full font-mono')}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-terracotta">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Policy saved.</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
      >
        {pending
          ? 'Saving…'
          : scope === 'tenant'
            ? 'Save tenant policy'
            : `Save policy${projectName ? ` for ${projectName}` : ''}`}
      </button>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-border text-forest"
      />
      {label}
    </label>
  );
}
