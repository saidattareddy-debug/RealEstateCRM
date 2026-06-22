import 'server-only';
import {
  createMockAdapter,
  evaluateProviderActivation,
  INTEGRATION_PROVIDERS,
  type ExternalIntegrationAdapter,
  type IntegrationProvider,
  type ProviderActivationDecision,
} from '@re/domain';
import { deploymentProfile, liveProviderActivationEnabled } from '@re/config';

/**
 * Phase 7A adapter registry.
 *
 * Every provider resolves to a deterministic MOCK/fixture adapter (the domain
 * factories). There are NO real network adapters in Phase 7A: a real adapter is
 * a server-only stub that throws `not_enabled_phase_7a`. Nothing here performs
 * external IO, opens a socket, or sends a customer message.
 */

/** Marker error thrown by the (intentionally inert) real-adapter stubs. */
export const NOT_ENABLED = 'not_enabled_phase_7a';

/**
 * A provider whose real adapter would perform network IO. In Phase 7A the real
 * path is a stub that throws — only the mock adapter is ever used.
 */
function createRealAdapterStub(provider: IntegrationProvider): ExternalIntegrationAdapter {
  return {
    provider,
    capabilities: [],
    async verifyConnection() {
      throw new Error(NOT_ENABLED);
    },
    async verifyWebhook() {
      throw new Error(NOT_ENABLED);
    },
    async parseWebhook() {
      throw new Error(NOT_ENABLED);
    },
    async pullEvents() {
      throw new Error(NOT_ENABLED);
    },
    async sendHumanMessage() {
      throw new Error(NOT_ENABLED);
    },
  };
}

const MOCK_REGISTRY: Record<IntegrationProvider, ExternalIntegrationAdapter> = Object.fromEntries(
  INTEGRATION_PROVIDERS.map((p) => [p, createMockAdapter(p)]),
) as Record<IntegrationProvider, ExternalIntegrationAdapter>;

/**
 * Resolve the adapter for a provider. In Phase 7A this is always the mock
 * adapter. Pass `{ real: true }` only to obtain the inert stub (used by tests /
 * future phases); it throws `not_enabled_phase_7a` on any call.
 */
export function resolveAdapter(
  provider: IntegrationProvider,
  opts: { real?: boolean } = {},
): ExternalIntegrationAdapter {
  if (opts.real) return createRealAdapterStub(provider);
  return MOCK_REGISTRY[provider] ?? createMockAdapter(provider);
}

/** All providers known to the registry (for UI selection). */
export function listProviders(): readonly IntegrationProvider[] {
  return INTEGRATION_PROVIDERS;
}

/**
 * Phase-7B activation-gated adapter resolution.
 *
 * Consults the pure activation decision (`evaluateProviderActivation`) using the
 * server env (deployment profile + the `INTEGRATION_LIVE_PROVIDERS_ENABLED`
 * operator flag). Because the engineering key
 * (`LIVE_PROVIDER_ACTIVATION_IMPLEMENTED`) is `false`, the decision is ALWAYS
 * `allowed: false`, so this returns the inert stub (which throws
 * `not_enabled_phase_7a` on any call) and never a network adapter. The decision
 * is returned alongside for observability / UI.
 *
 * Operator prerequisites (verified credentials present, webhook-domain verified,
 * provider review, paid + compliance approvals, sandbox smoke, named approver)
 * are not yet persisted, so they are reported as unmet here. When the real
 * adapters land in a future, separately reviewed Phase-7B implementation PR, the
 * `decision.allowed` branch becomes reachable and returns them.
 */
export function resolveActivationAdapter(
  provider: IntegrationProvider,
  env: Record<string, string | undefined> = process.env,
): { adapter: ExternalIntegrationAdapter; decision: ProviderActivationDecision } {
  const decision = evaluateProviderActivation({
    deploymentProfile: deploymentProfile(env),
    runtimeFlagEnabled: liveProviderActivationEnabled(env),
    // Operator prerequisites are not yet tracked in a store — treat as unmet so
    // the decision is honest and the inert path is always taken.
    credentialsPresent: false,
    webhookDomainVerified: false,
    providerAppReviewApproved: false,
    paidServiceApproved: false,
    complianceApproved: false,
    sandboxSmokePassed: false,
    namedApprover: null,
  });

  if (decision.allowed) {
    // Unreachable while the engineering key is false. Fail loudly rather than
    // silently doing nothing if this is ever reached without real adapters wired.
    throw new Error('live_provider_adapter_not_wired');
  }

  // Inert real-adapter stub: throws `not_enabled_phase_7a` on every call.
  return { adapter: resolveAdapter(provider, { real: true }), decision };
}
