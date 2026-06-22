import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publicWebhooksEnabled, deploymentProfile } from '@re/config';

// Stub the server module graph the route depends on so the gate can be tested
// in isolation (no real Supabase client, no DB).
const ingestWebhook = vi.fn();
const resolveEndpointByPublicId = vi.fn();
vi.mock('@/lib/integrations/ingest', () => ({
  ingestWebhook: (...a: unknown[]) => ingestWebhook(...a),
  resolveEndpointByPublicId: (...a: unknown[]) => resolveEndpointByPublicId(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock('@/lib/integrations/secrets', () => ({ secretRefConfigured: () => true }));

import { POST } from '@/app/api/integrations/webhooks/[publicEndpointId]/route';

const req = (body = '{}') =>
  new Request('http://localhost/api/integrations/webhooks/abc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
const params = Promise.resolve({ publicEndpointId: 'abc' });

beforeEach(() => {
  ingestWebhook.mockReset();
  resolveEndpointByPublicId.mockReset();
  delete process.env.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED;
});
afterEach(() => {
  delete process.env.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED;
});

describe('public-webhook feature gate', () => {
  it('defaults to disabled, and controlled_mvp is the default profile', () => {
    expect(publicWebhooksEnabled({})).toBe(false);
    expect(publicWebhooksEnabled({ INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: 'true' })).toBe(true);
    expect(publicWebhooksEnabled({ INTEGRATION_PUBLIC_WEBHOOKS_ENABLED: 'false' })).toBe(false);
    expect(deploymentProfile({})).toBe('controlled_mvp');
  });

  it('rejects provider POSTs generically (404) while disabled, without touching ingestion', async () => {
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(404);
    expect(ingestWebhook).not.toHaveBeenCalled();
    expect(resolveEndpointByPublicId).not.toHaveBeenCalled();
  });

  it('when enabled, resolves the endpoint and routes to ingestion', async () => {
    process.env.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED = 'true';
    resolveEndpointByPublicId.mockResolvedValue({
      connectionId: 'c1',
      tenantId: 't1',
      provider: 'whatsapp_cloud',
      disabled: false,
      endpointActive: true,
      requiresSignature: true,
      secretRef: 'WA_SECRET',
    });
    ingestWebhook.mockResolvedValue({ ok: true, status: 'processed', eventId: 'e1' });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(202);
    expect(resolveEndpointByPublicId).toHaveBeenCalledOnce();
    expect(ingestWebhook).toHaveBeenCalledOnce();
  });

  it('when enabled but endpoint unknown/revoked → generic 404', async () => {
    process.env.INTEGRATION_PUBLIC_WEBHOOKS_ENABLED = 'true';
    resolveEndpointByPublicId.mockResolvedValue(null);
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(404);
    expect(ingestWebhook).not.toHaveBeenCalled();
  });
});
