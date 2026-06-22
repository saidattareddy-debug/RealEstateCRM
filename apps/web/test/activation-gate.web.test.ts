import { describe, it, expect, afterEach } from 'vitest';
import { NOT_ENABLED, resolveActivationAdapter } from '@/lib/integrations/registry';
import { INTEGRATION_PROVIDERS } from '@re/domain';

/**
 * Phase-7B activation gate (server). Proves that even with the operator runtime
 * flag forced ON and the deployment profile set to `full`, the registry NEVER
 * returns a live network adapter — it returns the inert stub (which throws
 * `not_enabled_phase_7a`) and a decision with `allowed: false`. The runtime
 * no-external-IO trap (setup.web.ts) is also in force.
 */

const ON = {
  INTEGRATION_LIVE_PROVIDERS_ENABLED: 'true',
  DEPLOYMENT_PROFILE: 'full',
} satisfies Record<string, string>;

afterEach(() => {
  delete process.env.INTEGRATION_LIVE_PROVIDERS_ENABLED;
  delete process.env.DEPLOYMENT_PROFILE;
});

describe('resolveActivationAdapter — never returns a live adapter', () => {
  it('returns an inert stub + blocked decision even with the flag ON and profile=full', async () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const { adapter, decision } = resolveActivationAdapter(provider, ON);
      expect(decision.allowed).toBe(false);
      expect(decision.codePathImplemented).toBe(false);
      expect(decision.blockers).toContain('engineering_not_implemented');
      // Every adapter capability throws the not-enabled marker — nothing connects.
      await expect(adapter.verifyConnection({} as never)).rejects.toThrow(NOT_ENABLED);
      const send = adapter.sendHumanMessage;
      expect(send).toBeTypeOf('function');
      if (send) await expect(send({} as never, {} as never)).rejects.toThrow(NOT_ENABLED);
    }
  });

  it('defaults (no env) are also blocked', () => {
    const { decision } = resolveActivationAdapter('whatsapp_cloud', {});
    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toContain('runtime_flag_off');
    expect(decision.blockers).toContain('profile_not_full');
  });
});
