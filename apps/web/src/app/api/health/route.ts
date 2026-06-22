import { NextResponse } from 'next/server';
import { deploymentProfile, publicWebhooksEnabled } from '@re/config';

/**
 * Health / readiness endpoint. Returns NO secrets and exposes no database
 * internals. `status` is liveness (the process is up); `ready` is readiness (the
 * app is serving). It also surfaces the controlled-MVP safety posture so an uptime
 * monitor can alert if a gate ever flips unexpectedly.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      status: 'ok', // liveness
      ready: true, // readiness
      profile: deploymentProfile(),
      publicWebhooks: publicWebhooksEnabled() ? 'enabled' : 'disabled',
      liveSending: 'disabled',
      automaticCustomerSending: 'impossible',
      time: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
