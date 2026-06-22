import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied, EmptyState } from '@/components/ui/states';
import {
  computeCompleteness,
  effectiveScore,
  type QualField,
  type QualImportance,
  type LeadScoreResult,
  type ScoreClassification,
  type ScoreOverride,
} from '@re/domain';
import { AddNoteForm, StageMover, AssignSelect, CallLogForm } from '../lead-forms';
import { CreateTaskForm, TaskDoneButton } from '../../tasks/task-forms';
import { RecalculateButton, OverrideForm } from './scoring-panel';
import {
  RecalculateMatchButton,
  MatchOverrideControl,
  MatchFeedbackControl,
} from './matching-panel';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'leads.read.assigned')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase
    .from('leads')
    .select(
      'id, full_name, primary_phone_national, primary_email, operational_status, category, score, stage_id, campaign, preferred_language, lead_sources(name, kind)',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) notFound();

  const [
    { data: stages },
    { data: notes },
    { data: history },
    { data: assignment },
    { data: dups },
    { data: qualFields },
    { data: prefs },
    { data: calls },
  ] = await Promise.all([
    supabase.from('pipeline_stages').select('id, name, sort_order, is_lost').order('sort_order'),
    supabase
      .from('lead_notes')
      .select('id, body, created_at')
      .eq('lead_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('lead_stage_history')
      .select('id, created_at, to_stage_id')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('lead_assignments')
      .select('agent_id, profiles(full_name)')
      .eq('lead_id', id)
      .eq('active', true)
      .maybeSingle(),
    supabase
      .from('lead_duplicates')
      .select('id, confidence, status')
      .eq('lead_id', id)
      .eq('status', 'open'),
    supabase.from('qualification_fields').select('field_key, importance').order('sort_order'),
    supabase
      .from('lead_preferences')
      .select(
        'budget_min, budget_max, configuration, preferred_location, purchase_timeline, purpose',
      )
      .eq('lead_id', id)
      .maybeSingle(),
    supabase
      .from('calls')
      .select('id, direction, status, outcome, duration_seconds, notes, created_at')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // Build a value map keyed by qualification field_key from lead columns + preferences.
  const prefRow = prefs as Record<string, unknown> | null;
  const qualValues: Record<string, unknown> = {
    full_name: lead.full_name,
    primary_phone: lead.primary_phone_national,
    primary_email: lead.primary_email,
    preferred_language: lead.preferred_language,
    budget: prefRow?.budget_min ?? prefRow?.budget_max ?? null,
    configuration: prefRow?.configuration ?? null,
    preferred_location: prefRow?.preferred_location ?? null,
    purchase_timeline: prefRow?.purchase_timeline ?? null,
    purpose: prefRow?.purpose ?? null,
  };
  const qFields: QualField[] = (qualFields ?? []).map((f) => ({
    key: f.field_key as string,
    importance: f.importance as QualImportance,
  }));
  const completeness = qFields.length > 0 ? computeCompleteness(qFields, qualValues) : null;

  const canMove = ensurePermission(ctx, 'pipeline.move');
  const canAssign =
    ensurePermission(ctx, 'leads.assign') || ensurePermission(ctx, 'leads.reassign');
  const canNote = ensurePermission(ctx, 'leads.update');
  const canTask = ensurePermission(ctx, 'tasks.manage');

  // --- Lead scoring (advisory; read-only here) ---
  const canReadScore = ensurePermission(ctx, 'scoring.read');
  const canRunScore = ensurePermission(ctx, 'scoring.run');
  const canOverrideScore = ensurePermission(ctx, 'scoring.override');

  let scoring: {
    run: {
      score: number;
      classification: ScoreClassification;
      evidence_completeness: number;
      calculation_confidence: number;
      qualification_complete: boolean;
      disqualified: boolean;
      disqualification_reason: string | null;
      review_required: boolean;
      review_reason: string | null;
      calculated_at: string;
      model_version: string;
    } | null;
    effective: ReturnType<typeof effectiveScore> | null;
    components: {
      group_key: string | null;
      signal_key: string;
      contribution: number;
      applied: boolean;
      skipped_reason: string | null;
      explanation: string | null;
    }[];
    history: {
      id: string;
      previous_score: number | null;
      new_score: number | null;
      previous_classification: string | null;
      new_classification: string | null;
      trigger: string | null;
      model_version: string | null;
      created_at: string;
    }[];
    override: { reason: string; expires_at: string | null } | null;
  } | null = null;

  if (canReadScore) {
    const { data: latestRun } = await supabase
      .from('lead_score_runs')
      .select(
        'id, score, classification, evidence_completeness, calculation_confidence, qualification_complete, disqualified, disqualification_reason, review_required, review_reason, calculated_at, model_version_id, scoring_model_versions(version)',
      )
      .eq('lead_id', id)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const [{ data: comps }, { data: hist }, { data: ovr }] = await Promise.all([
      latestRun
        ? supabase
            .from('lead_score_components')
            .select('group_key, signal_key, contribution, applied, skipped_reason, explanation')
            .eq('run_id', latestRun.id as string)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from('lead_score_history')
        .select(
          'id, previous_score, new_score, previous_classification, new_classification, trigger, model_version, created_at',
        )
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('lead_score_overrides')
        .select('score, classification, reason, applied_at, expires_at')
        .eq('lead_id', id)
        .is('removed_at', null)
        .order('applied_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const runVersion =
      (latestRun?.scoring_model_versions as unknown as { version: string } | null)?.version ?? '—';

    let eff: ReturnType<typeof effectiveScore> | null = null;
    if (latestRun) {
      // Build a minimal LeadScoreResult for effectiveScore (uses score + class).
      const resultLike: LeadScoreResult = {
        score: latestRun.score as number,
        classification: latestRun.classification as ScoreClassification,
        evidenceCompleteness: 0,
        calculationConfidence: 0,
        components: [],
        appliedRules: [],
        skippedRules: [],
        missingSignals: [],
        contradictions: [],
        disqualification: { disqualified: false },
        reviewRequired: { required: false },
        qualificationComplete: false,
        explanation: [],
        modelVersion: runVersion,
        calculatedAt: latestRun.calculated_at as string,
      };
      const override: ScoreOverride | null = ovr
        ? {
            score: (ovr.score as number | null) ?? undefined,
            classification: (ovr.classification as ScoreClassification | null) ?? undefined,
            reason: ovr.reason as string,
            actorId: '',
            appliedAt: (ovr.applied_at as string) ?? new Date().toISOString(),
            expiresAt: (ovr.expires_at as string | null) ?? undefined,
          }
        : null;
      eff = effectiveScore(resultLike, override, new Date().toISOString());
    }

    scoring = {
      run: latestRun
        ? {
            score: latestRun.score as number,
            classification: latestRun.classification as ScoreClassification,
            evidence_completeness: latestRun.evidence_completeness as number,
            calculation_confidence: latestRun.calculation_confidence as number,
            qualification_complete: Boolean(latestRun.qualification_complete),
            disqualified: Boolean(latestRun.disqualified),
            disqualification_reason: (latestRun.disqualification_reason as string | null) ?? null,
            review_required: Boolean(latestRun.review_required),
            review_reason: (latestRun.review_reason as string | null) ?? null,
            calculated_at: latestRun.calculated_at as string,
            model_version: runVersion,
          }
        : null,
      effective: eff,
      components: (comps ?? []) as NonNullable<typeof scoring>['components'],
      history: (hist ?? []) as NonNullable<typeof scoring>['history'],
      override: ovr
        ? { reason: ovr.reason as string, expires_at: (ovr.expires_at as string | null) ?? null }
        : null,
    };
  }

  // --- Lead matching (advisory; read-only here) ---
  const canReadMatch = ensurePermission(ctx, 'matching.read');
  const canRunMatch = ensurePermission(ctx, 'matching.run');
  const canOverrideMatch = ensurePermission(ctx, 'matching.override');
  const canFeedbackMatch = ensurePermission(ctx, 'matching.feedback.create');

  interface MatchCandidateView {
    id: string;
    level: string;
    project_id: string | null;
    project_configuration_id: string | null;
    inventory_unit_id: string | null;
    eligible: boolean;
    score: number;
    classification: string;
    confidence: number;
    preference_completeness: number;
    inventory_state: string;
    unit_confirmed: boolean;
    budget_outcome: string;
    rank: number;
    hard_failures: string[];
    projectName: string;
    components: {
      signal_key: string;
      contribution: number;
      positive: boolean;
      group_key: string | null;
    }[];
  }

  let matching: {
    runId: string;
    calculatedAt: string;
    modelVersion: string;
    inventorySnapshotAt: string | null;
    candidates: MatchCandidateView[];
  } | null = null;

  if (canReadMatch) {
    const { data: latestMatchRun } = await supabase
      .from('lead_match_runs')
      .select(
        'id, calculated_at, inventory_snapshot_at, model_version_id, matching_model_versions(version)',
      )
      .eq('lead_id', id)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMatchRun) {
      const { data: candRows } = await supabase
        .from('lead_match_candidates')
        .select(
          'id, level, project_id, project_configuration_id, inventory_unit_id, eligible, score, classification, confidence, preference_completeness, inventory_state, unit_confirmed, budget_outcome, rank, hard_failures',
        )
        .eq('run_id', latestMatchRun.id as string)
        .order('rank', { ascending: true })
        .limit(20);

      const candidateIds = (candRows ?? []).map((c) => c.id as string);
      const projectIds = Array.from(
        new Set((candRows ?? []).map((c) => c.project_id).filter((p): p is string => Boolean(p))),
      );

      const [{ data: projRows }, { data: compRows }] = await Promise.all([
        projectIds.length > 0
          ? supabase.from('projects').select('id, name').in('id', projectIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        candidateIds.length > 0
          ? supabase
              .from('lead_match_components')
              .select('candidate_id, signal_key, contribution, positive, group_key')
              .in('candidate_id', candidateIds)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);

      const projectNames = new Map(
        ((projRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
      );
      const compsByCandidate = new Map<
        string,
        { signal_key: string; contribution: number; positive: boolean; group_key: string | null }[]
      >();
      for (const c of (compRows ?? []) as {
        candidate_id: string;
        signal_key: string;
        contribution: number;
        positive: boolean;
        group_key: string | null;
      }[]) {
        const arr = compsByCandidate.get(c.candidate_id) ?? [];
        arr.push({
          signal_key: c.signal_key,
          contribution: Number(c.contribution),
          positive: c.positive,
          group_key: c.group_key,
        });
        compsByCandidate.set(c.candidate_id, arr);
      }

      matching = {
        runId: latestMatchRun.id as string,
        calculatedAt: latestMatchRun.calculated_at as string,
        inventorySnapshotAt: (latestMatchRun.inventory_snapshot_at as string | null) ?? null,
        modelVersion:
          (latestMatchRun.matching_model_versions as unknown as { version: string } | null)
            ?.version ?? '—',
        candidates: (candRows ?? []).map((c) => ({
          id: c.id as string,
          level: c.level as string,
          project_id: (c.project_id as string | null) ?? null,
          project_configuration_id: (c.project_configuration_id as string | null) ?? null,
          inventory_unit_id: (c.inventory_unit_id as string | null) ?? null,
          eligible: Boolean(c.eligible),
          score: c.score as number,
          classification: c.classification as string,
          confidence: Number(c.confidence),
          preference_completeness: Number(c.preference_completeness),
          inventory_state: c.inventory_state as string,
          unit_confirmed: Boolean(c.unit_confirmed),
          budget_outcome: c.budget_outcome as string,
          rank: c.rank as number,
          hard_failures: (c.hard_failures as string[]) ?? [],
          projectName: c.project_id ? (projectNames.get(c.project_id as string) ?? 'Project') : '—',
          components: compsByCandidate.get(c.id as string) ?? [],
        })),
      };
    }
  }

  const { data: tasks } = canTask
    ? await supabase
        .from('tasks')
        .select('id, title, due_at, status')
        .eq('lead_id', id)
        .eq('status', 'open')
        .order('due_at', { ascending: true, nullsFirst: false })
    : { data: [] };

  let agents: { id: string; name: string }[] = [];
  if (canAssign) {
    const { data: members } = await supabase
      .from('memberships')
      .select('profile_id, profiles(full_name), roles!inner(slug)')
      .eq('roles.slug', 'sales_agent');
    agents = (members ?? []).map((m) => ({
      id: m.profile_id as string,
      name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? 'Agent',
    }));
  }

  const source = lead.lead_sources as unknown as { name: string; kind: string } | null;
  const assignedName = (assignment?.profiles as unknown as { full_name: string | null } | null)
    ?.full_name;

  const phoneDigits = String(lead.primary_phone_national ?? '').replace(/[^\d]/g, '');

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">
          {lead.full_name ?? 'Unnamed lead'}
        </h1>
        <p className="text-sm text-text-secondary">
          {lead.primary_phone_national ?? '—'} · {lead.primary_email ?? '—'} ·{' '}
          {lead.preferred_language ?? 'en'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Status & pipeline" id="status">
          <dl className="space-y-2 text-sm">
            <Row label="Operational status" value={String(lead.operational_status)} />
            <Row label="Category" value={lead.category ? String(lead.category) : 'unscored'} />
            <Row label="Score" value={String(lead.score)} />
            <Row label="Source" value={source ? `${source.name} (${source.kind})` : '—'} />
            <Row label="Campaign" value={lead.campaign ?? '—'} />
          </dl>
          {canMove ? (
            <div className="mt-3">
              <StageMover
                leadId={lead.id as string}
                stageId={(lead.stage_id as string | null) ?? null}
                stages={(stages ?? []).map((s) => ({
                  id: s.id as string,
                  name: s.name as string,
                  isLost: Boolean(s.is_lost),
                }))}
              />
            </div>
          ) : null}
        </Panel>

        <Panel title="Assignment">
          <p className="mb-2 text-sm text-text-secondary">
            Current: <span className="text-text-primary">{assignedName ?? 'unassigned'}</span>
          </p>
          {canAssign ? (
            <AssignSelect
              leadId={lead.id as string}
              currentAgentId={(assignment?.agent_id as string | null) ?? null}
              agents={agents}
            />
          ) : null}
          {dups && dups.length > 0 ? (
            <p className="mt-3 text-sm text-terracotta">
              {dups.length} possible duplicate(s) flagged — see Duplicate review.
            </p>
          ) : null}
        </Panel>
      </div>

      {completeness ? (
        <Panel title="Qualification completeness">
          <p className="mb-1 text-xs text-text-secondary">
            Information-gathering progress — not a lead-quality score.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label="Overall" pct={completeness.overallPct} />
            <Meter label="Required" pct={completeness.requiredPct} />
            <Meter label="Important" pct={completeness.importantPct} />
          </div>
          {completeness.missingRequired.length > 0 ? (
            <p className="mt-3 text-sm text-terracotta">
              Missing required: {completeness.missingRequired.join(', ')}
            </p>
          ) : null}
          {completeness.missingImportant.length > 0 ? (
            <p className="mt-1 text-sm text-text-secondary">
              Missing important: {completeness.missingImportant.join(', ')}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {canReadScore ? (
        <Panel title="Lead score (advisory)">
          <p className="mb-3 text-xs text-text-secondary">
            Deterministic, explainable and advisory — it never changes this lead’s stage, assignment
            or status, and never sends anything.
          </p>
          {!scoring?.run ? (
            <div className="space-y-3">
              <EmptyState
                title="Not scored yet"
                hint="Record observations or recalculate to produce a score."
              />
              {canRunScore ? <RecalculateButton leadId={lead.id as string} /> : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat
                  label="Effective score"
                  value={String(scoring.effective?.effectiveScore ?? scoring.run.score)}
                  hint={scoring.effective?.overrideActive ? 'manual override' : 'calculated'}
                />
                <Stat label="Calculated score" value={String(scoring.run.score)} />
                <Stat
                  label="Classification"
                  value={String(
                    scoring.effective?.effectiveClassification ?? scoring.run.classification,
                  )}
                />
                <Stat
                  label="Qualification"
                  value={scoring.run.qualification_complete ? 'complete' : 'incomplete'}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Meter label="Evidence" pct={Math.round(scoring.run.evidence_completeness * 100)} />
                <Meter
                  label="Confidence"
                  pct={Math.round(scoring.run.calculation_confidence * 100)}
                />
                <div className="text-sm">
                  <p className="text-text-secondary">Model version</p>
                  <p className="text-text-primary">{scoring.run.model_version}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Last calculated {new Date(scoring.run.calculated_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {scoring.run.disqualified ? (
                <p className="rounded-md border border-terracotta/40 bg-terracotta/5 p-2 text-sm text-terracotta">
                  Disqualification recommended: {scoring.run.disqualification_reason ?? '—'}
                </p>
              ) : null}
              {scoring.run.review_required ? (
                <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm text-warning">
                  Review required: {scoring.run.review_reason ?? '—'}
                </p>
              ) : null}
              {scoring.override ? (
                <p className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text-secondary">
                  Active override: {scoring.override.reason}
                  {scoring.override.expires_at
                    ? ` (expires ${new Date(scoring.override.expires_at).toLocaleString()})`
                    : ''}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Top positive signals
                  </h3>
                  {scoring.components.filter((c) => c.applied && c.contribution > 0).length ===
                  0 ? (
                    <p className="text-sm text-text-secondary">None.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {scoring.components
                        .filter((c) => c.applied && c.contribution > 0)
                        .sort((a, b) => b.contribution - a.contribution)
                        .slice(0, 5)
                        .map((c, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="text-text-primary">{c.signal_key}</span>
                            <span className="text-forest">+{c.contribution}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Missing / skipped info
                  </h3>
                  {scoring.components.filter((c) => !c.applied).length === 0 ? (
                    <p className="text-sm text-text-secondary">None.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-text-secondary">
                      {scoring.components
                        .filter((c) => !c.applied)
                        .slice(0, 6)
                        .map((c, i) => (
                          <li key={i}>
                            {c.signal_key} — {c.skipped_reason ?? 'skipped'}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>

              {scoring.history.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Score history
                  </h3>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {scoring.history.map((h) => (
                      <li key={h.id}>
                        {new Date(h.created_at).toLocaleString()} — {h.previous_score ?? '—'} →{' '}
                        {h.new_score ?? '—'} ({h.new_classification ?? '—'}) ·{' '}
                        {h.trigger ?? 'manual'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                {canRunScore ? <RecalculateButton leadId={lead.id as string} /> : null}
                {canOverrideScore ? (
                  <OverrideForm
                    leadId={lead.id as string}
                    hasActiveOverride={Boolean(scoring.override)}
                  />
                ) : null}
              </div>
            </div>
          )}
        </Panel>
      ) : null}

      {canReadMatch ? (
        <Panel title="Recommended projects (advisory)">
          <p className="mb-3 text-xs text-text-secondary">
            Deterministic, explainable and advisory. A recommendation is NOT a reservation or a
            confirmed offer — it never assigns this lead, changes its stage/status/score, reserves
            inventory or sends anything. A specific unit is only shown as confirmed available when
            its real inventory record is available and freshly verified.
          </p>
          {!matching ? (
            <div className="space-y-3">
              <EmptyState
                title="No matches calculated yet"
                hint="Recalculate to produce recommendations from current projects and inventory."
              />
              {canRunMatch ? <RecalculateMatchButton leadId={lead.id as string} /> : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                <span>Model version {matching.modelVersion}</span>
                <span>Last calculated {new Date(matching.calculatedAt).toLocaleString()}</span>
                {matching.inventorySnapshotAt ? (
                  <span>
                    Inventory snapshot {new Date(matching.inventorySnapshotAt).toLocaleString()}
                  </span>
                ) : null}
              </div>

              {matching.candidates.length === 0 ? (
                <EmptyState title="No candidate projects" />
              ) : (
                <ul className="space-y-3">
                  {matching.candidates.map((c) => (
                    <li key={c.id} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">
                            #{c.rank} {c.projectName}
                          </span>
                          <Tag label={c.level} />
                          <Tag
                            label={c.classification.replace('_', ' ')}
                            tone={
                              c.classification === 'excellent' || c.classification === 'good'
                                ? 'success'
                                : c.classification === 'ineligible'
                                  ? 'terracotta'
                                  : c.classification === 'review_required'
                                    ? 'warning'
                                    : 'neutral'
                            }
                          />
                          <Tag label={`score ${c.score}`} />
                          <Tag label={`confidence ${(c.confidence * 100).toFixed(0)}%`} />
                          <Tag
                            label={`completeness ${(c.preference_completeness * 100).toFixed(0)}%`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Tag label={`inventory: ${c.inventory_state.replace(/_/g, ' ')}`} />
                        <Tag label={`budget: ${c.budget_outcome.replace(/_/g, ' ')}`} />
                        {c.level === 'unit' ? (
                          c.unit_confirmed ? (
                            <Tag label="unit confirmed available" tone="success" />
                          ) : (
                            <Tag label="unit not confirmed" tone="warning" />
                          )
                        ) : null}
                      </div>

                      {c.hard_failures.length > 0 ? (
                        <p className="text-sm text-terracotta">
                          Exclusion reasons: {c.hard_failures.join(', ')}
                        </p>
                      ) : null}

                      {c.components.filter((m) => m.positive && m.contribution > 0).length > 0 ? (
                        <p className="text-sm text-text-secondary">
                          Fit:{' '}
                          {c.components
                            .filter((m) => m.positive && m.contribution > 0)
                            .sort((a, b) => b.contribution - a.contribution)
                            .slice(0, 5)
                            .map((m) => `${m.signal_key} (+${m.contribution})`)
                            .join(', ')}
                        </p>
                      ) : null}

                      {(canOverrideMatch || canFeedbackMatch) && c.id ? (
                        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                          {canOverrideMatch ? (
                            <MatchOverrideControl
                              leadId={lead.id as string}
                              runId={matching.runId}
                              candidateId={c.id}
                            />
                          ) : null}
                          {canFeedbackMatch ? (
                            <MatchFeedbackControl
                              leadId={lead.id as string}
                              runId={matching.runId}
                              candidateId={c.id}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canRunMatch ? (
                <div className="border-t border-border pt-3">
                  <RecalculateMatchButton leadId={lead.id as string} />
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}

      {canNote ? (
        <Panel title="Calls">
          <div className="mb-3">
            <CallLogForm leadId={lead.id as string} />
          </div>
          {!calls || calls.length === 0 ? (
            <EmptyState title="No calls logged" />
          ) : (
            <ul className="space-y-2 text-sm">
              {calls.map((c) => (
                <li key={c.id} className="border-b border-border/50 pb-2 last:border-0">
                  <p className="text-text-primary">
                    <span className="capitalize">{String(c.direction)}</span> ·{' '}
                    <span className="capitalize">{String(c.status).replace('_', ' ')}</span>
                    {c.duration_seconds ? (
                      <span className="text-text-secondary"> · {String(c.duration_seconds)}s</span>
                    ) : null}
                  </p>
                  {c.outcome ? <p className="text-text-secondary">{String(c.outcome)}</p> : null}
                  {c.notes ? <p className="text-text-secondary">{String(c.notes)}</p> : null}
                  <p className="text-xs text-text-secondary">
                    {new Date(c.created_at as string).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel title="Notes" id="notes">
        {canNote ? (
          <div className="mb-3">
            <AddNoteForm leadId={lead.id as string} />
          </div>
        ) : null}
        {!notes || notes.length === 0 ? (
          <EmptyState title="No notes yet" />
        ) : (
          <ul className="space-y-2 text-sm">
            {notes.map((n) => (
              <li key={n.id} className="border-b border-border/50 pb-2 last:border-0">
                <p className="text-text-primary">{n.body}</p>
                <p className="text-xs text-text-secondary">
                  {new Date(n.created_at as string).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canTask ? (
        <Panel title="Tasks" id="tasks">
          <div className="mb-3">
            <CreateTaskForm leadId={lead.id as string} />
          </div>
          {!tasks || tasks.length === 0 ? (
            <EmptyState title="No open tasks" />
          ) : (
            <ul className="space-y-1 text-sm">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between border-b border-border/50 py-1 last:border-0"
                >
                  <span className="text-text-primary">
                    {t.title}
                    {t.due_at ? (
                      <span className="ml-2 text-xs text-text-secondary">
                        due {new Date(t.due_at as string).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                  <TaskDoneButton taskId={t.id as string} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel title="Stage history">
        {!history || history.length === 0 ? (
          <EmptyState title="No stage changes yet" />
        ) : (
          <ul className="space-y-1 text-sm text-text-secondary">
            {history.map((h) => (
              <li key={h.id}>{new Date(h.created_at as string).toLocaleString()} — moved stage</li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Mobile sticky quick actions. WhatsApp is only an external deep link. */}
      <nav
        aria-label="Lead quick actions"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-border bg-surface p-2 md:hidden"
      >
        <StickyAction href={phoneDigits ? `tel:${phoneDigits}` : undefined} label="Call" />
        <StickyAction
          href={phoneDigits ? `https://wa.me/${phoneDigits}` : undefined}
          label="WhatsApp"
          external
        />
        <StickyAction href="#notes" label="Note" />
        <StickyAction href="#tasks" label="Task" />
        <StickyAction href="#status" label="Stage" />
      </nav>
    </div>
  );
}

function StickyAction({
  href,
  label,
  external = false,
}: {
  href?: string;
  label: string;
  external?: boolean;
}) {
  const cls =
    'flex-1 rounded-md border border-border px-2 py-2 text-center text-xs font-medium text-text-primary';
  if (!href) return <span className={`${cls} opacity-40`}>{label}</span>;
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cls}
    >
      {label}
    </a>
  );
}

function Tag({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'success' | 'warning' | 'terracotta' | 'neutral';
}) {
  const cls =
    tone === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'terracotta'
          ? 'border-terracotta/40 bg-terracotta/10 text-terracotta'
          : 'border-border bg-surface-elevated text-text-secondary';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="capitalize text-text-primary">{value}</dd>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-3">
      <p className="text-xs uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold capitalize text-text-primary">{value}</p>
      {hint ? <p className="text-xs text-text-secondary">{hint}</p> : null}
    </div>
  );
}

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-text-secondary">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-elevated">
        <div className="h-2 rounded-full bg-forest" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
