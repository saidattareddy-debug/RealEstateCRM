import { describe, expect, it } from 'vitest';
import { checkDeploymentIdentity, supabaseProjectRef } from '../deployment-identity';

describe('supabaseProjectRef', () => {
  it('extracts the project ref from a hosted Supabase URL', () => {
    expect(supabaseProjectRef('https://abcd1234.supabase.co')).toBe('abcd1234');
    expect(supabaseProjectRef('http://localhost:54321')).toBeNull();
  });
});

describe('checkDeploymentIdentity', () => {
  it('passes for a valid staging configuration', () => {
    const res = checkDeploymentIdentity({
      target: 'staging',
      appEnv: 'staging',
      appUrl: 'https://staging.example.com',
      supabaseUrl: 'https://stagingref.supabase.co',
      expectedProjectRef: 'stagingref',
      stagingProjectRef: 'stagingref',
      productionProjectRef: 'prodref',
    });
    expect(res.ok).toBe(true);
  });

  it('fails when staging and production refs are identical', () => {
    const res = checkDeploymentIdentity({
      target: 'staging',
      appEnv: 'staging',
      supabaseUrl: 'https://same.supabase.co',
      stagingProjectRef: 'same',
      productionProjectRef: 'same',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/must be different/);
  });

  it('fails when staging points at the production ref', () => {
    const res = checkDeploymentIdentity({
      target: 'staging',
      appEnv: 'staging',
      supabaseUrl: 'https://prodref.supabase.co',
      stagingProjectRef: 'stagingref',
      productionProjectRef: 'prodref',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/PRODUCTION/);
  });

  it('fails when production points at the staging ref', () => {
    const res = checkDeploymentIdentity({
      target: 'production',
      appEnv: 'production',
      appUrl: 'https://app.example.com',
      supabaseUrl: 'https://stagingref.supabase.co',
      stagingProjectRef: 'stagingref',
      productionProjectRef: 'prodref',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/STAGING/);
  });

  it('fails when APP_ENV does not match the target', () => {
    const res = checkDeploymentIdentity({
      target: 'production',
      appEnv: 'staging',
      appUrl: 'https://app.example.com',
      supabaseUrl: 'https://prodref.supabase.co',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/APP_ENV must be production/);
  });
});
