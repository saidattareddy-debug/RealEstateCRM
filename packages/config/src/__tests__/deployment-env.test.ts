import { describe, it, expect } from 'vitest';
import {
  checkDeploymentReady,
  getServerEnv,
  liveProviderActivationEnabled,
  type ServerEnv,
} from '../env';

const base = (over: Partial<ServerEnv> = {}): ServerEnv =>
  ({
    APP_ENV: 'production',
    DEPLOYMENT_MODE: 'shared',
    DEPLOYMENT_PROFILE: 'controlled_mvp',
    INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: false,
    INTEGRATION_LIVE_PROVIDERS_ENABLED: false,
    SUPABASE_SERVICE_ROLE_KEY: 'svc-secret',
    SESSION_SIGNING_SECRET: 'sess-secret',
    EMBEDDINGS_PROVIDER: 'openai',
    SENTRY_DSN: 'https://sentry.example/123',
    ...over,
  }) as ServerEnv;

const completeOpts = {
  appUrl: 'https://crm.example.com',
  supabaseUrl: 'https://proj.supabase.co',
  anonKey: 'anon-key',
  rawEnv: {} as Record<string, string | undefined>,
};

describe('checkDeploymentReady', () => {
  it('non-production is always ready (no prod hardening required)', () => {
    expect(checkDeploymentReady(base({ APP_ENV: 'local', SENTRY_DSN: undefined })).ok).toBe(true);
    expect(checkDeploymentReady(base({ APP_ENV: 'staging', SENTRY_DSN: undefined })).ok).toBe(true);
  });

  it('a complete controlled_mvp production config is ready', () => {
    expect(checkDeploymentReady(base(), completeOpts).ok).toBe(true);
  });

  it('production without error monitoring is NOT ready', () => {
    const r = checkDeploymentReady(base({ SENTRY_DSN: undefined }), completeOpts);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/SENTRY_DSN/);
  });

  it('production without a session-signing secret is NOT ready', () => {
    const r = checkDeploymentReady(base({ SESSION_SIGNING_SECRET: undefined }), completeOpts);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/SESSION_SIGNING_SECRET/);
  });

  it('production missing Supabase URL / anon key is NOT ready', () => {
    const r = checkDeploymentReady(base(), { ...completeOpts, supabaseUrl: null, anonKey: null });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(r.problems.join(' ')).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('controlled_mvp production with public webhooks / live-send switch on is NOT ready', () => {
    expect(
      checkDeploymentReady(base({ INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: true }), completeOpts).ok,
    ).toBe(false);
    const r = checkDeploymentReady(base(), {
      ...completeOpts,
      rawEnv: { LIVE_SEND_MASTER_SWITCH: 'true' },
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/LIVE_SEND_MASTER_SWITCH/);
  });

  it('controlled_mvp production may enable live draft providers while send switches stay off', () => {
    const r = checkDeploymentReady(
      base({ INTEGRATION_LIVE_PROVIDERS_ENABLED: true }),
      completeOpts,
    );
    expect(r.ok).toBe(true);
  });

  it('controlled_mvp production also allows the raw live-provider flag', () => {
    const r = checkDeploymentReady(base(), {
      ...completeOpts,
      rawEnv: { INTEGRATION_LIVE_PROVIDERS_ENABLED: 'true' },
    });
    expect(r.ok).toBe(true);
  });

  it('a secret exposed through a NEXT_PUBLIC_* variable is NOT ready', () => {
    const r = checkDeploymentReady(base(), {
      ...completeOpts,
      rawEnv: { NEXT_PUBLIC_LEAK: 'svc-secret' },
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/NEXT_PUBLIC_LEAK/);
  });

  it('production with a localhost app URL is NOT ready', () => {
    const r = checkDeploymentReady(base(), { ...completeOpts, appUrl: 'http://localhost:3000' });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/non-localhost https/);
  });
});

describe('getServerEnv production gate', () => {
  const fullEnv = (over: Record<string, string | undefined> = {}) => ({
    APP_ENV: 'production',
    DEPLOYMENT_PROFILE: 'controlled_mvp',
    INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: 'false',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    SESSION_SIGNING_SECRET: 'sess',
    NEXT_PUBLIC_APP_URL: 'https://crm.example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SENTRY_DSN: 'https://sentry.example/1',
    ...over,
  });

  it('throws when a production deploy is missing error monitoring', () => {
    expect(() => getServerEnv(fullEnv({ SENTRY_DSN: undefined }))).toThrow(
      /Production configuration incomplete/,
    );
  });

  it('throws when a server secret leaks into a public variable', () => {
    expect(() => getServerEnv(fullEnv({ NEXT_PUBLIC_OOPS: 'svc' }))).toThrow(
      /public variable NEXT_PUBLIC_OOPS/,
    );
  });

  it('succeeds for a complete production config', () => {
    expect(() => getServerEnv(fullEnv())).not.toThrow();
  });

  it('allows controlled_mvp production to enable live draft providers', () => {
    expect(() =>
      getServerEnv(fullEnv({ INTEGRATION_LIVE_PROVIDERS_ENABLED: 'true' })),
    ).not.toThrow();
  });
});

describe('liveProviderActivationEnabled', () => {
  it('defaults to false (absent / any non-"true" value)', () => {
    expect(liveProviderActivationEnabled({})).toBe(false);
    expect(liveProviderActivationEnabled({ INTEGRATION_LIVE_PROVIDERS_ENABLED: 'false' })).toBe(
      false,
    );
    expect(liveProviderActivationEnabled({ INTEGRATION_LIVE_PROVIDERS_ENABLED: '1' })).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    expect(liveProviderActivationEnabled({ INTEGRATION_LIVE_PROVIDERS_ENABLED: 'true' })).toBe(
      true,
    );
  });
});
