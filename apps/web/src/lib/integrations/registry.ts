import 'server-only';
import {
  createMockAdapter,
  INTEGRATION_PROVIDERS,
  type ExternalIntegrationAdapter,
  type IntegrationProvider,
} from '@re/domain';

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
