/**
 * Safety gate for the controlled-MVP demo-data generator.
 *
 * The generator REFUSES to run unless every guard below passes. This is the
 * single most important file in the demo tooling: it is what guarantees the
 * generator can never touch production, never flip a live-send / webhook
 * switch, and never run without an explicit, typed human acknowledgement.
 *
 * Pure logic (no IO) so it is exhaustively unit-testable. `evaluateSafety`
 * takes a plain env-like record + parsed CLI options and returns a structured
 * verdict; callers throw `SafetyError` when `.ok` is false.
 */

export const DATASET_ID = 'controlled-mvp-demo-v1';
export const SYNTHETIC_EMAIL_DOMAIN = '@northwind-demo.example';
export const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_CREATES_SYNTHETIC_DATA';

/** Northwind Estates staging tenant from the seed (resolve by id, not slug). */
export const NORTHWIND_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const NORTHWIND_SLUGS = ['northwind', 'northwind-estates'];

/**
 * Known production Supabase project refs that must NEVER be a demo target.
 * Provided via the DEMO_BLOCKED_PROJECT_REFS env (comma separated). Any hit
 * refuses the run.
 */
const PRODUCTION_PROJECT_REFS = (process.env.DEMO_BLOCKED_PROJECT_REFS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Hostname substrings that look like production and must be refused. */
const PRODUCTION_HOST_MARKERS = ['prod', 'production', 'live', 'app.northwind', 'crm.northwind'];

export class SafetyError extends Error {
  constructor(message, problems) {
    super(message);
    this.name = 'SafetyError';
    this.problems = problems ?? [message];
  }
}

function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || null;
  }
}

/** Extract a Supabase project ref from a URL like https://<ref>.supabase.co */
export function supabaseProjectRef(url) {
  const host = hostOf(url);
  if (!host) return null;
  const m = /^([a-z0-9-]+)\.supabase\.(co|in|net)$/i.exec(host);
  return m ? m[1] : null;
}

/**
 * Evaluate the full safety gate. Returns { ok, problems, target }.
 * `env` is a process.env-like record; `opts` are parsed CLI options.
 */
export function evaluateSafety(env, opts = {}) {
  const problems = [];
  const e = env ?? {};

  if (e.ALLOW_DEMO_DATA_SEED !== 'true') {
    problems.push('ALLOW_DEMO_DATA_SEED must be exactly "true"');
  }
  if ((e.DEPLOYMENT_PROFILE ?? 'controlled_mvp') !== 'controlled_mvp') {
    problems.push('DEPLOYMENT_PROFILE must be "controlled_mvp"');
  }
  if (e.NODE_ENV === 'production') problems.push('NODE_ENV must not be "production"');
  if (e.APP_ENV === 'production') problems.push('APP_ENV must not be "production"');
  if ((e.ENVIRONMENT_NAME ?? '').toLowerCase() === 'production') {
    problems.push('ENVIRONMENT_NAME must not be "production"');
  }
  if (e.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED === 'true') {
    problems.push('INTEGRATION_PUBLIC_WEBHOOKS_ENABLED must be false');
  }
  if (e.LIVE_SEND_MASTER_SWITCH === 'true') {
    problems.push('LIVE_SEND_MASTER_SWITCH must be false');
  }
  if (e.RESPONDER_LIVE_SENDING === 'true') {
    problems.push('RESPONDER_LIVE_SENDING must be false');
  }
  if (e.DEMO_SEED_CONFIRMATION !== REQUIRED_CONFIRMATION) {
    problems.push('DEMO_SEED_CONFIRMATION must equal ' + REQUIRED_CONFIRMATION);
  }

  const supaUrl = e.NEXT_PUBLIC_SUPABASE_URL ?? e.SUPABASE_URL ?? null;
  const ref = supabaseProjectRef(supaUrl);
  if (ref && PRODUCTION_PROJECT_REFS.includes(ref)) {
    problems.push('Supabase project ref "' + ref + '" is on the production block list');
  }
  const supaHost = hostOf(supaUrl);
  if (supaHost && PRODUCTION_HOST_MARKERS.some((m) => supaHost.toLowerCase().includes(m))) {
    problems.push('Supabase host "' + supaHost + '" looks like a production target');
  }

  const appUrl = e.NEXT_PUBLIC_APP_URL ?? e.APP_URL ?? null;
  const appHost = hostOf(appUrl);
  if (appHost && PRODUCTION_HOST_MARKERS.some((m) => appHost.toLowerCase().includes(m))) {
    problems.push('APP_URL host "' + appHost + '" looks like a production domain');
  }

  if (!opts.dryRun && !opts.confirm) {
    problems.push('writes require --confirm (use --dry-run to preview without writing)');
  }

  return {
    ok: problems.length === 0,
    problems,
    target: {
      supabaseHost: supaHost,
      supabaseRef: ref,
      appHost,
      tenant: opts.tenant ?? null,
    },
  };
}

/** Throw a SafetyError if the gate fails. Returns the target descriptor. */
export function assertSafe(env, opts) {
  const v = evaluateSafety(env, opts);
  if (!v.ok) {
    throw new SafetyError('Demo-data safety gate refused this run', v.problems);
  }
  return v.target;
}
