import { describe, it, expect } from 'vitest';
import { NO_IO_MESSAGE } from './setup.web';
import { resolveAdapter } from '@/lib/integrations/registry';

describe('runtime no-external-IO trap', () => {
  it('globalThis.fetch is trapped and throws', () => {
    expect(() => (globalThis.fetch as () => unknown)()).toThrow(NO_IO_MESSAGE);
  });

  it('the real provider adapter is an inert stub that throws not_enabled_phase_7a', async () => {
    const stub = resolveAdapter('whatsapp_cloud', { real: true });
    await expect(
      Promise.resolve().then(() =>
        stub.parseWebhook?.(
          { method: 'POST', headers: {}, rawBody: '{}', receivedAt: new Date().toISOString() },
          {
            tenantId: 't',
            integrationConnectionId: 'c',
            provider: 'whatsapp_cloud',
            now: new Date(),
          },
        ),
      ),
    ).rejects.toThrow('not_enabled_phase_7a');
  });
});
