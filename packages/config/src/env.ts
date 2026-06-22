import { z } from 'zod';

/**
 * Environment validation. Fails fast at boot on missing/invalid values.
 * Secrets are SERVER-ONLY and must never be read into client bundles.
 * See docs/SECURITY.md §4 and docs/DEPLOYMENT.md §3.
 */

/** Client-safe variables (may be exposed to the browser). */
const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/** Server-only variables (secrets). Never imported into client code. */
const serverSchema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  DEPLOYMENT_MODE: z.enum(['shared', 'dedicated']).default('shared'),
  /**
   * Deployment profile. `controlled_mvp` is the safe default: core CRM + website
   * chat + advisory scoring/matching on; public provider webhooks, real adapters,
   * live sends and binary media OFF. `full` is reserved for a later phase.
   */
  DEPLOYMENT_PROFILE: z.enum(['controlled_mvp', 'full']).default('controlled_mvp'),
  /**
   * Phase-7A public-webhook gate. Defaults to false and is validated server-side
   * only (never a writable browser setting). While false, provider webhook POSTs
   * are rejected generically; internal fixture/testing actions are unaffected and
   * the core CRM / website-chat are not disabled.
   */
  INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Live-provider activation gate (server-side, default OFF). This enables real
   * server-side AI draft providers when the code path exists and credentials are
   * configured. It does NOT, by itself, permit customer sending; the live-send
   * switches remain separately enforced. Never a writable browser setting.
   */
  INTEGRATION_LIVE_PROVIDERS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDINGS_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  /** Server-only secret used to sign website-chat session tokens, etc. */
  SESSION_SIGNING_SECRET: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

/**
 * Build the client env source from LITERAL property references so Next.js can
 * statically inline NEXT_PUBLIC_* values into client/edge bundles (passing the
 * whole `process.env` object defeats inlining and breaks in the Edge runtime).
 */
function readClientEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Validate and return client-safe env. Safe to call anywhere (incl. Edge). */
export function getClientEnv(
  source: Record<string, string | undefined> = readClientEnv(),
): ClientEnv {
  const parsed = clientSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid client environment:\n${format(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Validate and return server env (includes secrets).
 * MUST only be called from server-side code (Server Components, route handlers,
 * server actions, Edge Functions).
 */
export function getServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${format(parsed.error)}`);
  }
  // Fail startup if a production deploy is missing required hardening/monitoring.
  assertDeploymentReady(parsed.data, {
    appUrl: source.NEXT_PUBLIC_APP_URL ?? null,
    supabaseUrl: source.NEXT_PUBLIC_SUPABASE_URL ?? null,
    anonKey: source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    rawEnv: source,
  });
  return parsed.data;
}

export type DeploymentProfile = 'controlled_mvp' | 'full';

export interface DeploymentReadiness {
  ok: boolean;
  problems: string[];
}

/**
 * Production-readiness checks for the server environment. A production deploy must
 * have error monitoring configured and must keep the controlled-MVP safety gates
 * closed. Returns the list of problems (empty = ready). Pure — unit-testable.
 */
export interface DeploymentReadyOpts {
  appUrl?: string | null;
  supabaseUrl?: string | null;
  anonKey?: string | null;
  /** Raw process.env-style record, for public-var leak + safety-switch checks. */
  rawEnv?: Record<string, string | undefined>;
}

export function checkDeploymentReady(
  server: ServerEnv,
  opts?: DeploymentReadyOpts,
): DeploymentReadiness {
  const problems: string[] = [];
  if (server.APP_ENV !== 'production') return { ok: true, problems };

  // Required production configuration.
  if (!server.SENTRY_DSN) problems.push('SENTRY_DSN (error monitoring) is required in production');
  if (!server.SUPABASE_SERVICE_ROLE_KEY)
    problems.push('SUPABASE_SERVICE_ROLE_KEY is required in production (server-only)');
  if (!server.SESSION_SIGNING_SECRET)
    problems.push('SESSION_SIGNING_SECRET is required in production');
  if (!opts?.supabaseUrl) problems.push('NEXT_PUBLIC_SUPABASE_URL is required in production');
  if (!opts?.anonKey) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production');
  const url = opts?.appUrl;
  if (!url) problems.push('NEXT_PUBLIC_APP_URL is required in production');
  else if (!url.startsWith('https://') || /localhost|127\.0\.0\.1/.test(url))
    problems.push('NEXT_PUBLIC_APP_URL must be a non-localhost https URL in production');

  // Controlled-MVP safety gates must stay closed.
  const raw = opts?.rawEnv ?? {};
  if (server.DEPLOYMENT_PROFILE === 'controlled_mvp') {
    if (server.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED)
      problems.push(
        'controlled_mvp production must keep INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false',
      );
    if (raw.LIVE_SEND_MASTER_SWITCH === 'true')
      problems.push('controlled_mvp production must keep LIVE_SEND_MASTER_SWITCH disabled');
    if (raw.RESPONDER_LIVE_SENDING === 'true')
      problems.push('controlled_mvp production must keep RESPONDER_LIVE_SENDING disabled');
    if (raw.BINARY_MEDIA_RETRIEVAL_ENABLED === 'true')
      problems.push('controlled_mvp production must keep binary media retrieval disabled');
  }

  // No server secret may be exposed through a browser-visible NEXT_PUBLIC_* var.
  const secrets = [server.SUPABASE_SERVICE_ROLE_KEY, server.SESSION_SIGNING_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('NEXT_PUBLIC_') || !v) continue;
    if (secrets.includes(v) || /service_role/i.test(v))
      problems.push(`secret value must not be exposed through the public variable ${k}`);
  }

  return { ok: problems.length === 0, problems };
}

/** Throw (fail startup) when production configuration is incomplete. */
export function assertDeploymentReady(server: ServerEnv, opts?: DeploymentReadyOpts): void {
  const r = checkDeploymentReady(server, opts);
  if (!r.ok) {
    throw new Error(
      'Production configuration incomplete:\n' + r.problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
}

/**
 * Phase-7A public-webhook gate (server-side, default OFF). Reads the raw env so
 * it works without the full secret set (routes + tests). While false, provider
 * webhook POSTs must be rejected generically.
 */
export function publicWebhooksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED === 'true';
}

/** Deployment profile (server-side, default `controlled_mvp`). */
export function deploymentProfile(
  env: Record<string, string | undefined> = process.env,
): DeploymentProfile {
  return env.DEPLOYMENT_PROFILE === 'full' ? 'full' : 'controlled_mvp';
}

/**
 * Live-provider activation gate (server-side, default OFF). While false, the AI
 * runtime never returns a live external provider adapter.
 */
export function liveProviderActivationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.INTEGRATION_LIVE_PROVIDERS_ENABLED === 'true';
}

export { clientSchema, serverSchema };
