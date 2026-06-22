export type DeploymentTarget = 'staging' | 'production';

export interface DeploymentIdentityInput {
  target: DeploymentTarget;
  appEnv?: string | null;
  appUrl?: string | null;
  supabaseUrl?: string | null;
  expectedProjectRef?: string | null;
  stagingProjectRef?: string | null;
  productionProjectRef?: string | null;
}

export interface DeploymentIdentityResult {
  ok: boolean;
  projectRef: string | null;
  problems: string[];
}

export function supabaseProjectRef(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

export function checkDeploymentIdentity(input: DeploymentIdentityInput): DeploymentIdentityResult {
  const problems: string[] = [];
  const projectRef = supabaseProjectRef(input.supabaseUrl);

  if (input.appEnv && input.appEnv !== input.target) {
    problems.push(`APP_ENV must be ${input.target} for a ${input.target} preflight`);
  }

  if (input.expectedProjectRef && projectRef && input.expectedProjectRef !== projectRef) {
    problems.push(
      `Supabase project ref mismatch: env points at '${projectRef}', expected '${input.expectedProjectRef}'`,
    );
  }

  if (
    input.stagingProjectRef &&
    input.productionProjectRef &&
    input.stagingProjectRef === input.productionProjectRef
  ) {
    problems.push('staging and production Supabase project refs must be different');
  }

  if (input.target === 'staging' && projectRef && input.productionProjectRef === projectRef) {
    problems.push(`staging preflight points at the PRODUCTION Supabase project '${projectRef}'`);
  }

  if (input.target === 'production' && projectRef && input.stagingProjectRef === projectRef) {
    problems.push(`production preflight points at the STAGING Supabase project '${projectRef}'`);
  }

  if (input.target === 'production' && input.appUrl) {
    if (!input.appUrl.startsWith('https://') || /localhost|127\.0\.0\.1/.test(input.appUrl)) {
      problems.push('production NEXT_PUBLIC_APP_URL must be a non-localhost https URL');
    }
  }

  return { ok: problems.length === 0, projectRef, problems };
}
