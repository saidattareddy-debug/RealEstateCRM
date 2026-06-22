/**
 * Configurable qualification completeness (MASTER_SPEC §14). Pure.
 * Completeness is an information-gathering metric — NOT a quality/score signal
 * (no Hot/Warm/Cold here).
 */

export type QualImportance = 'required' | 'important' | 'optional' | 'disabled';

export interface QualField {
  key: string;
  importance: QualImportance;
}

export interface CompletenessResult {
  overallPct: number;
  requiredPct: number;
  importantPct: number;
  missingRequired: string[];
  missingImportant: string[];
}

function present(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** Compute completeness over the active (non-disabled) fields. */
export function computeCompleteness(
  fields: readonly QualField[],
  values: Record<string, unknown>,
): CompletenessResult {
  const active = fields.filter((f) => f.importance !== 'disabled');
  const required = active.filter((f) => f.importance === 'required');
  const important = active.filter((f) => f.importance === 'important');

  const filled = (list: readonly QualField[]) => list.filter((f) => present(values[f.key]));
  const pct = (num: number, den: number) => (den === 0 ? 100 : Math.round((num / den) * 100));

  return {
    overallPct: pct(filled(active).length, active.length),
    requiredPct: pct(filled(required).length, required.length),
    importantPct: pct(filled(important).length, important.length),
    missingRequired: required.filter((f) => !present(values[f.key])).map((f) => f.key),
    missingImportant: important.filter((f) => !present(values[f.key])).map((f) => f.key),
  };
}
