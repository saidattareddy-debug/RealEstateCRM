import { describe, it, expect } from 'vitest';
import {
  evaluateSafety,
  assertSafe,
  SafetyError,
  supabaseProjectRef,
  REQUIRED_CONFIRMATION,
} from '../../../scripts/demo/safety.mjs';
import { deterministicUuid, fakePhone, runIdFor } from '../../../scripts/demo/ids.mjs';

// A baseline env where every safety condition is satisfied.
function safeEnv(over: Record<string, string | undefined> = {}) {
  return {
    ALLOW_DEMO_DATA_SEED: 'true',
    DEPLOYMENT_PROFILE: 'controlled_mvp',
    NODE_ENV: 'development',
    APP_ENV: 'staging',
    ENVIRONMENT_NAME: 'staging',
    INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: 'false',
    LIVE_SEND_MASTER_SWITCH: 'false',
    RESPONDER_LIVE_SENDING: 'false',
    DEMO_SEED_CONFIRMATION: REQUIRED_CONFIRMATION,
    NEXT_PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
    NEXT_PUBLIC_APP_URL: 'https://staging.northwind-crm.test',
    ...over,
  };
}

describe('demo safety gate', () => {
  it('passes with a fully safe staging env + --confirm', () => {
    const v = evaluateSafety(safeEnv(), { confirm: true });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it('refuses in production (NODE_ENV/APP_ENV/ENVIRONMENT_NAME)', () => {
    expect(evaluateSafety(safeEnv({ NODE_ENV: 'production' }), { confirm: true }).ok).toBe(false);
    expect(evaluateSafety(safeEnv({ APP_ENV: 'production' }), { confirm: true }).ok).toBe(false);
    expect(evaluateSafety(safeEnv({ ENVIRONMENT_NAME: 'production' }), { confirm: true }).ok).toBe(
      false,
    );
  });

  it('refuses without the typed acknowledgement phrase', () => {
    const v = evaluateSafety(safeEnv({ DEMO_SEED_CONFIRMATION: 'nope' }), { confirm: true });
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('DEMO_SEED_CONFIRMATION');
  });

  it('refuses when ALLOW_DEMO_DATA_SEED is not exactly true', () => {
    expect(evaluateSafety(safeEnv({ ALLOW_DEMO_DATA_SEED: undefined }), { confirm: true }).ok).toBe(
      false,
    );
    expect(evaluateSafety(safeEnv({ ALLOW_DEMO_DATA_SEED: '1' }), { confirm: true }).ok).toBe(
      false,
    );
  });

  it('refuses when public webhooks are enabled', () => {
    const v = evaluateSafety(safeEnv({ INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: 'true' }), {
      confirm: true,
    });
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('INTEGRATION_PUBLIC_WEBHOOKS_ENABLED');
  });

  it('refuses when any live-send switch is on', () => {
    expect(evaluateSafety(safeEnv({ LIVE_SEND_MASTER_SWITCH: 'true' }), { confirm: true }).ok).toBe(
      false,
    );
    expect(evaluateSafety(safeEnv({ RESPONDER_LIVE_SENDING: 'true' }), { confirm: true }).ok).toBe(
      false,
    );
  });

  it('refuses a production-looking Supabase host / APP_URL domain', () => {
    expect(
      evaluateSafety(safeEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://prod-db.supabase.co' }), {
        confirm: true,
      }).ok,
    ).toBe(false);
    expect(
      evaluateSafety(safeEnv({ NEXT_PUBLIC_APP_URL: 'https://app.northwind.com' }), {
        confirm: true,
      }).ok,
    ).toBe(false);
  });

  it('refuses a write without --confirm (but allows --dry-run)', () => {
    expect(evaluateSafety(safeEnv(), {}).ok).toBe(false);
    expect(evaluateSafety(safeEnv(), { dryRun: true }).ok).toBe(true);
  });

  it('assertSafe throws a SafetyError with problems', () => {
    expect(() => assertSafe(safeEnv({ NODE_ENV: 'production' }), { confirm: true })).toThrow(
      SafetyError,
    );
  });

  it('parses a supabase project ref from a url', () => {
    expect(supabaseProjectRef('https://abcd1234.supabase.co')).toBe('abcd1234');
    expect(supabaseProjectRef('http://localhost:5432')).toBe(null);
  });
});

describe('demo deterministic keys (idempotency foundation)', () => {
  const T = '11111111-1111-1111-1111-111111111111';

  it('deterministicUuid is stable for the same inputs', () => {
    const a = deterministicUuid(T, 'project', 'verdant-grove');
    const b = deterministicUuid(T, 'project', 'verdant-grove');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('deterministicUuid differs across kinds and keys', () => {
    expect(deterministicUuid(T, 'project', 'a')).not.toBe(deterministicUuid(T, 'project', 'b'));
    expect(deterministicUuid(T, 'unit', 'a')).not.toBe(deterministicUuid(T, 'project', 'a'));
  });

  it('fakePhone is a valid-looking E.164 in the reserved fake block', () => {
    expect(fakePhone(1)).toMatch(/^\+9199999\d{6}$/);
  });

  it('runIdFor is stable per (tenant, dataset)', () => {
    expect(runIdFor(T, 'controlled-mvp-demo-v1')).toBe(runIdFor(T, 'controlled-mvp-demo-v1'));
  });
});
