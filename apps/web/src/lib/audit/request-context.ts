import 'server-only';
import { headers } from 'next/headers';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  correlationId: string;
}

/** Extract IP / user-agent / request + correlation IDs for audit records. */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  const userAgent = h.get('user-agent');
  const requestId = h.get('x-request-id') || crypto.randomUUID();
  const correlationId = h.get('x-correlation-id') || requestId;
  return { ip, userAgent: userAgent ?? null, requestId, correlationId };
}
