import 'server-only';
import {
  decideWebhookAcceptance,
  decideIdempotency,
  payloadHash as computePayloadHash,
  classifyFailure,
  type IntegrationContext,
  type IntegrationProvider,
  type NormalizedExternalEvent,
  type RawWebhookRequest,
  type WebhookRejectReason,
} from '@re/domain';
import { validateDeliveryTransition } from '@re/domain';
import { minimizeNormalizedPayload } from '@re/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';
import { ingestLead, type SourceKind } from '@/lib/leads/ingest';
import { ingestConversationMessage } from '@/lib/conversations/ingest-message';
import { resolveAdapter } from './registry';
import { computeWebhookSignature } from './secrets';
import { recomputeConnectionHealth } from './health';

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const MAX_BODY_BYTES = 1_000_000;
const REPLAY_WINDOW_SECONDS = 300;

/** Map a delivery-callback event type to the delivery-lifecycle status it advances to. */
const CALLBACK_DELIVERY_STATUS: Record<string, string | undefined> = {
  message_accepted: 'queued',
  message_sent: 'sent',
  message_delivered: 'delivered',
  message_read: 'read',
  message_failed: 'failed',
};

/** Connection row resolved from the endpoint (NEVER from the payload). */
export interface ResolvedEndpoint {
  connectionId: string;
  tenantId: string;
  provider: IntegrationProvider;
  status: string;
  disabled: boolean;
  /** Webhook secret reference (env-var name). Resolved server-side only. */
  secretRef: string | null;
  verificationTokenRef: string | null;
  endpointActive: boolean;
  requiresSignature: boolean;
}

export type IngestOutcome =
  | { ok: true; status: 'processed' | 'duplicate'; eventId: string }
  | { ok: false; status: 'rejected' | 'failed'; reason: string };

/**
 * Resolve the integration + tenant from a public connectionId + its configured
 * webhook endpoint. The payload is never consulted for tenant/provider — that is
 * the whole point (prevents cross-tenant spoofing). Returns null when unknown.
 */
export async function resolveEndpointByConnection(
  admin: Admin,
  connectionId: string,
): Promise<ResolvedEndpoint | null> {
  const { data: conn } = await admin
    .from('integration_connections')
    .select('id, tenant_id, provider, status')
    .eq('id', connectionId)
    .maybeSingle();
  if (!conn) return null;

  const { data: endpoint } = await admin
    .from('channel_webhook_endpoints')
    .select('secret_ref, verification_token_ref, active')
    .eq('tenant_id', conn.tenant_id as string)
    .eq('connection_id', conn.id as string)
    .maybeSingle();

  const provider = conn.provider as IntegrationProvider;
  // Email/portal-pull providers verify by token challenge, not HMAC signature.
  const tokenOnly = provider === 'gmail' || provider === 'imap_email';
  return {
    connectionId: conn.id as string,
    tenantId: conn.tenant_id as string,
    provider,
    status: conn.status as string,
    disabled: conn.status === 'disabled',
    secretRef: (endpoint?.secret_ref as string | null) ?? null,
    verificationTokenRef: (endpoint?.verification_token_ref as string | null) ?? null,
    endpointActive: endpoint ? Boolean(endpoint.active) : false,
    requiresSignature: !tokenOnly,
  };
}

/**
 * Resolve the connection + tenant from an OPAQUE, rotatable public endpoint id
 * (`channel_webhook_endpoints.public_id`) — never from the request body, and not
 * derived from any tenant or connection id. A revoked/inactive endpoint resolves
 * to null and the route fails generically (no tenant-existence disclosure).
 */
export async function resolveEndpointByPublicId(
  admin: Admin,
  publicId: string,
): Promise<ResolvedEndpoint | null> {
  const { data: endpoint } = await admin
    .from('channel_webhook_endpoints')
    .select('connection_id, tenant_id, secret_ref, verification_token_ref, active')
    .eq('public_id', publicId)
    .maybeSingle();
  if (!endpoint || !endpoint.active) return null;
  return resolveEndpointByConnection(admin, endpoint.connection_id as string);
}

/** Map a provider to the lead-ingestion `sourceKind`. */
function sourceKindFor(provider: IntegrationProvider): SourceKind {
  switch (provider) {
    case 'meta_lead_ads':
    case 'google_lead_forms':
      return 'ad';
    case 'nobroker':
    case 'ninetynine_acres':
    case 'housing':
    case 'magicbricks':
    case 'generic_portal':
      return 'portal';
    case 'whatsapp_cloud':
      return 'whatsapp';
    case 'gmail':
    case 'imap_email':
      return 'email';
    default:
      return 'webhook';
  }
}

/**
 * Persist-before-process webhook ingestion (record-only / mock in Phase 7A).
 *
 * Flow: gate the request via `decideWebhookAcceptance` (HMAC computed
 * server-side from the secret-ref, never logged) → normalize via the mock
 * adapter → for each normalized event, persist `external_events` (DB unique
 * constraint enforces idempotency) → on duplicate, classify and skip side
 * effects → route lead/message events through the EXISTING lead/conversation
 * ingestion services (tenant-safe, identity resolved from `external_identity_links`)
 * → record attempt + success/failure → recompute health. Audits safe metadata
 * only (never payloads or secrets). NO external IO, NO sending.
 */
export async function ingestWebhook(args: {
  endpoint: ResolvedEndpoint;
  raw: RawWebhookRequest;
  providedSignature?: string;
  timestamp?: string;
  correlationId: string;
  now?: Date;
}): Promise<IngestOutcome> {
  const admin = createSupabaseAdminClient();
  const { endpoint, raw, correlationId } = args;
  const now = args.now ?? new Date();
  const tenantId = endpoint.tenantId;

  // Server-computed HMAC over the raw body (secret never leaves secrets.ts).
  const computedSignature = endpoint.requiresSignature
    ? (computeWebhookSignature(endpoint.secretRef, raw.rawBody) ?? undefined)
    : undefined;

  const acceptance = decideWebhookAcceptance({
    method: raw.method,
    allowedMethods: ['POST'],
    contentType: raw.headers['content-type'],
    allowedContentTypes: ['application/json', 'application/x-www-form-urlencoded'],
    bodySize: Buffer.byteLength(raw.rawBody, 'utf8'),
    maxBodySize: MAX_BODY_BYTES,
    providedSignature: args.providedSignature,
    computedSignature,
    timestamp: args.timestamp,
    now,
    replayWindowSeconds: REPLAY_WINDOW_SECONDS,
    integrationKnown: true,
    integrationDisabled: endpoint.disabled || !endpoint.endpointActive,
    requiresSignature: endpoint.requiresSignature,
  });

  if (!acceptance.accept) {
    await writeAudit({
      action: 'INTEGRATION_WEBHOOK_REJECTED',
      tenantId,
      entityType: 'integration_connection',
      entityId: endpoint.connectionId,
      metadata: { reason: acceptance.reason as WebhookRejectReason, provider: endpoint.provider },
    });
    return { ok: false, status: 'rejected', reason: acceptance.reason };
  }

  await writeAudit({
    action: 'INTEGRATION_WEBHOOK_VERIFIED',
    tenantId,
    entityType: 'integration_connection',
    entityId: endpoint.connectionId,
    metadata: { provider: endpoint.provider },
  });

  // TRUE persist-before-process: persist a durable AUTHENTICATED envelope BEFORE
  // invoking the provider adapter. The raw body is NOT retained — so parse
  // failures are `resubmission_required` (not replayable). One authenticated
  // receipt → one envelope (UNIQUE receipt_idempotency_key blocks concurrent
  // duplicates).
  const bodyHash = computePayloadHash(raw.rawBody);
  const receiptKey = `${endpoint.connectionId}:${bodyHash}:${args.timestamp ?? ''}`;
  const { data: envRow, error: envErr } = await admin
    .from('external_event_envelopes')
    .insert({
      tenant_id: tenantId,
      integration_connection_id: endpoint.connectionId,
      provider: endpoint.provider,
      authenticated_at: now.toISOString(),
      request_method: raw.method,
      content_type: raw.headers['content-type'] ?? null,
      content_length: Buffer.byteLength(raw.rawBody, 'utf8'),
      body_hash: bodyHash,
      signature_scheme: endpoint.requiresSignature ? 'hmac_sha256' : 'verification_token',
      signature_timestamp: args.timestamp ?? null,
      correlation_id: correlationId,
      receipt_idempotency_key: receiptKey,
      processing_status: 'received',
      attempt_count: 1,
    })
    .select('id')
    .single();
  if (envErr) {
    if ((envErr as { code?: string }).code === '23505') {
      await writeAudit({
        action: 'INTEGRATION_EVENT_DUPLICATE',
        tenantId,
        entityType: 'integration_connection',
        entityId: endpoint.connectionId,
        metadata: { provider: endpoint.provider, reason: 'duplicate_receipt' },
      });
      return { ok: true, status: 'duplicate', eventId: '' };
    }
    return { ok: false, status: 'failed', reason: 'envelope_persist_failed' };
  }
  const envelopeId = envRow.id as string;
  await writeAudit({
    action: 'INTEGRATION_ENVELOPE_RECEIVED',
    tenantId,
    entityType: 'external_event_envelope',
    entityId: envelopeId,
    metadata: { provider: endpoint.provider },
  });

  const adapter = resolveAdapter(endpoint.provider);
  const ctx: IntegrationContext = {
    tenantId,
    integrationConnectionId: endpoint.connectionId,
    provider: endpoint.provider,
    now,
  };

  // Durable receipt committed — NOW invoke the adapter to parse + normalize.
  await admin
    .from('external_event_envelopes')
    .update({ processing_status: 'parsing' })
    .eq('id', envelopeId);
  let events: NormalizedExternalEvent[];
  try {
    events = adapter.parseWebhook ? await adapter.parseWebhook(raw, ctx) : [];
  } catch (e) {
    // Parse failure: the raw body was not retained, so this is
    // `resubmission_required` (NOT replayable). The envelope is the durable record.
    await admin
      .from('external_event_envelopes')
      .update({
        processing_status: 'resubmission_required',
        failure_category: 'parse_failure',
        safe_failure_summary: (e as Error).message?.slice(0, 200) ?? 'parse_error',
        completed_at: now.toISOString(),
      })
      .eq('id', envelopeId);
    await writeAudit({
      action: 'INTEGRATION_ENVELOPE_RESUBMISSION_REQUIRED',
      tenantId,
      entityType: 'external_event_envelope',
      entityId: envelopeId,
      metadata: { provider: endpoint.provider, reason: 'parse_failure' },
    });
    await recomputeConnectionHealth(admin, tenantId, endpoint.connectionId, { now });
    return { ok: false, status: 'failed', reason: 'parse_failed' };
  }

  if (events.length === 0) {
    await admin
      .from('external_event_envelopes')
      .update({ processing_status: 'processed', completed_at: now.toISOString() })
      .eq('id', envelopeId);
    return { ok: true, status: 'processed', eventId: '' };
  }

  await admin
    .from('external_event_envelopes')
    .update({ processing_status: 'normalized' })
    .eq('id', envelopeId);

  let lastEventId = '';
  let anyProcessed = false;
  let anyDuplicate = false;

  for (const ev of events) {
    const result = await processEvent(admin, endpoint, ev, correlationId, now, envelopeId);
    if (result.eventId) lastEventId = result.eventId;
    if (result.kind === 'processed') anyProcessed = true;
    if (result.kind === 'duplicate') anyDuplicate = true;
  }

  await admin
    .from('external_event_envelopes')
    .update({ processing_status: 'processed', completed_at: now.toISOString() })
    .eq('id', envelopeId);
  await recomputeConnectionHealth(admin, tenantId, endpoint.connectionId, { now });

  if (anyProcessed) return { ok: true, status: 'processed', eventId: lastEventId };
  if (anyDuplicate) return { ok: true, status: 'duplicate', eventId: lastEventId };
  return { ok: false, status: 'failed', reason: 'all_events_failed' };
}

type EventResult = { kind: 'processed' | 'duplicate' | 'failed' | 'rejected'; eventId: string };

/** Persist + process a single normalized event (idempotent on (tenant, key)). */
async function processEvent(
  admin: Admin,
  endpoint: ResolvedEndpoint,
  ev: NormalizedExternalEvent,
  correlationId: string,
  now: Date,
  envelopeId: string,
): Promise<EventResult> {
  const tenantId = endpoint.tenantId;

  // 1) Insert the normalized external_events row, linked to its envelope. The DB
  //    UNIQUE (tenant_id, idempotency_key) makes any duplicate a no-op.
  const { data: inserted, error: insErr } = await admin
    .from('external_events')
    .insert({
      tenant_id: tenantId,
      provider: endpoint.provider,
      connection_id: endpoint.connectionId,
      envelope_id: envelopeId,
      external_account_ref: ev.externalAccountId ?? null,
      external_event_id: ev.externalEventId,
      event_type: ev.eventType,
      occurred_at: ev.occurredAt,
      received_at: ev.receivedAt,
      payload_version: ev.payloadVersion,
      // Data minimization: store only the allow-listed, length-capped, secret-free
      // subset for this event type — never the full provider payload (§14).
      normalized_payload:
        minimizeNormalizedPayload(ev.eventType, ev.normalizedPayload).minimized ?? {},
      payload_hash: ev.payloadHash,
      idempotency_key: ev.idempotencyKey,
      correlation_id: ev.correlationId ?? correlationId,
      status: 'received',
    })
    .select('id')
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      // Idempotency collision — load the existing row to decide duplicate vs conflict.
      const { data: existing } = await admin
        .from('external_events')
        .select('id, payload_hash')
        .eq('tenant_id', tenantId)
        .eq('idempotency_key', ev.idempotencyKey)
        .maybeSingle();
      const decision = decideIdempotency(
        existing
          ? { idempotencyKey: ev.idempotencyKey, payloadHash: existing.payload_hash as string }
          : null,
        { idempotencyKey: ev.idempotencyKey, payloadHash: ev.payloadHash },
      );
      const existingId = (existing?.id as string) ?? '';
      if (decision === 'conflict_reject') {
        if (existingId) {
          await admin
            .from('external_events')
            .update({ status: 'rejected' })
            .eq('tenant_id', tenantId)
            .eq('id', existingId);
          await admin.from('external_event_failures').insert({
            tenant_id: tenantId,
            event_id: existingId,
            failure_class: 'permanent',
            error_code: 'idempotency_conflict',
            error_summary: 'same idempotency key, different payload',
          });
        }
        await writeAudit({
          action: 'INTEGRATION_EVENT_FAILED',
          tenantId,
          entityType: 'external_event',
          entityId: existingId || endpoint.connectionId,
          metadata: { reason: 'idempotency_conflict', provider: endpoint.provider },
        });
        return { kind: 'rejected', eventId: existingId };
      }
      // duplicate_ignore — do NOT re-run any side effect.
      await writeAudit({
        action: 'INTEGRATION_EVENT_DUPLICATE',
        tenantId,
        entityType: 'external_event',
        entityId: existingId || endpoint.connectionId,
        metadata: { provider: endpoint.provider, eventType: ev.eventType },
      });
      return { kind: 'duplicate', eventId: existingId };
    }
    // Unexpected DB error: nothing persisted; surface as failure.
    return { kind: 'failed', eventId: '' };
  }

  const eventId = inserted.id as string;
  await writeAudit({
    action: 'INTEGRATION_EVENT_RECEIVED',
    tenantId,
    entityType: 'external_event',
    entityId: eventId,
    metadata: { provider: endpoint.provider, eventType: ev.eventType },
  });

  await admin
    .from('external_events')
    .update({ status: 'processing' })
    .eq('tenant_id', tenantId)
    .eq('id', eventId);
  await admin.from('external_event_attempts').insert({
    tenant_id: tenantId,
    event_id: eventId,
    attempt_no: 1,
    status: 'processing',
  });

  // 2) Process: route to the EXISTING ingestion services. Idempotency is already
  //    guaranteed by the external_events row, so re-delivery cannot duplicate.
  try {
    const routed = await routeEvent(admin, endpoint, ev, eventId, correlationId);
    await admin
      .from('external_events')
      .update({
        status: 'processed',
        lead_id: routed.leadId ?? null,
        conversation_id: routed.conversationId ?? null,
      })
      .eq('tenant_id', tenantId)
      .eq('id', eventId);
    await admin
      .from('external_event_attempts')
      .insert({ tenant_id: tenantId, event_id: eventId, attempt_no: 2, status: 'processed' })
      .then(
        () => undefined,
        () => undefined,
      );
    await markLastSuccess(admin, tenantId, endpoint.connectionId, now);
    await writeAudit({
      action: 'INTEGRATION_EVENT_PROCESSED',
      tenantId,
      entityType: 'external_event',
      entityId: eventId,
      metadata: { provider: endpoint.provider, eventType: ev.eventType, routed: routed.kind },
    });
    return { kind: 'processed', eventId };
  } catch (e) {
    const message = (e as Error).message?.slice(0, 200) ?? 'process_error';
    const failureClass = classifyFailure(null, null);
    await admin
      .from('external_events')
      .update({ status: 'failed' })
      .eq('tenant_id', tenantId)
      .eq('id', eventId);
    await admin.from('external_event_failures').insert({
      tenant_id: tenantId,
      event_id: eventId,
      failure_class: failureClass,
      error_code: 'process_error',
      error_summary: message,
    });
    await admin
      .from('integration_connections')
      .update({ last_failure_at: now.toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', endpoint.connectionId);
    await writeAudit({
      action: 'INTEGRATION_EVENT_FAILED',
      tenantId,
      entityType: 'external_event',
      entityId: eventId,
      metadata: { provider: endpoint.provider, failureClass },
    });
    return { kind: 'failed', eventId };
  }
}

interface RouteResult {
  kind: 'lead' | 'message' | 'callback' | 'noop';
  leadId?: string | null;
  conversationId?: string | null;
}

/**
 * Route a normalized event to the existing pipelines. Lead events go through
 * `ingestLead` (its own idempotency keyed by externalEventId); message events
 * resolve identity via `external_identity_links` and append to the existing
 * conversation (idempotent on (tenant, conversation, external_message_id)).
 */
async function routeEvent(
  admin: Admin,
  endpoint: ResolvedEndpoint,
  ev: NormalizedExternalEvent,
  eventId: string,
  correlationId: string,
): Promise<RouteResult> {
  const tenantId = endpoint.tenantId;

  if (ev.eventType === 'lead_created' || ev.eventType === 'lead_updated') {
    const np = (ev.normalizedPayload ?? {}) as Record<string, unknown>;
    const res = await ingestLead(
      tenantId,
      {
        fullName: (np.name as string | null) ?? ev.subject.leadRef ?? null,
        phone: (np.phone as string | null) ?? ev.subject.contactPhone ?? null,
        email: (np.email as string | null) ?? ev.subject.contactEmail ?? null,
        source: endpoint.provider,
      },
      {
        sourceKind: sourceKindFor(endpoint.provider),
        externalEventId: ev.externalEventId,
        idempotencyKey: ev.idempotencyKey,
        correlationId,
      },
    );
    return { kind: 'lead', leadId: res.leadId || null };
  }

  if (ev.eventType === 'inbound_message') {
    const link = await resolveIdentityConversation(admin, endpoint, ev);
    if (!link.conversationId) {
      // No resolvable conversation/identity yet — record-only; not an error.
      return { kind: 'noop', leadId: link.leadId ?? null };
    }
    const np = (ev.normalizedPayload ?? {}) as Record<string, unknown>;
    const text = (np.text as string | null) ?? null;
    // Route through the CANONICAL conversation-ingestion service — never insert
    // into conversation_messages directly. Idempotent on the external event.
    const res = await ingestConversationMessage(
      {
        tenantId,
        conversationId: link.conversationId,
        leadId: link.leadId ?? null,
        body: text,
        externalMessageId: ev.externalEventId,
        idempotencyKey: ev.idempotencyKey,
        payloadHash: ev.payloadHash,
        correlationId,
        externalEventId: ev.externalEventId,
      },
      admin,
    );
    if (!res.ok) throw new Error('message ingestion failed');
    return { kind: 'message', leadId: link.leadId ?? null, conversationId: link.conversationId };
  }

  if (
    ev.eventType === 'message_accepted' ||
    ev.eventType === 'message_sent' ||
    ev.eventType === 'message_delivered' ||
    ev.eventType === 'message_read' ||
    ev.eventType === 'message_failed'
  ) {
    // Delivery callback: advance the EXISTING delivery lifecycle idempotently. A
    // callback NEVER creates a conversation, a customer message, or a delivered
    // outbound — it only appends a delivery-status row when the transition is a
    // legal forward move. Provider payloads are not copied into audit metadata.
    const np = (ev.normalizedPayload ?? {}) as Record<string, unknown>;
    const providerRef = (np.providerMessageId as string | null) ?? null;
    let reviewState: 'applied' | 'unknown_reference' | 'no_transition' = 'no_transition';

    if (providerRef) {
      // Latest delivery row for this provider reference (tenant-scoped — a callback
      // can never resolve a message in another tenant).
      const { data: latest } = await admin
        .from('message_delivery_events')
        .select('id, message_id, conversation_id, status')
        .eq('tenant_id', tenantId)
        .eq('provider_ref', providerRef)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest) {
        reviewState = 'unknown_reference'; // unknown provider message → review
      } else {
        const incoming = CALLBACK_DELIVERY_STATUS[ev.eventType];
        if (incoming && validateDeliveryTransition(latest.status as never, incoming as never)) {
          await admin.from('message_delivery_events').insert({
            tenant_id: tenantId,
            message_id: latest.message_id,
            conversation_id: latest.conversation_id,
            status: incoming,
            provider_ref: providerRef,
            failure_code: incoming === 'failed' ? 'provider_failed' : null,
          });
          reviewState = 'applied';
        }
        // else: duplicate / backward / illegal transition → idempotent no-op.
      }
    }

    if (endpoint.provider === 'whatsapp_cloud') {
      await admin.from('whatsapp_provider_events').insert({
        tenant_id: tenantId,
        event_id: eventId,
        provider_message_ref: providerRef,
        kind: ev.eventType,
      });
    }
    await writeAudit({
      action: 'INTEGRATION_EVENT_PROCESSED',
      tenantId,
      entityType: 'external_event',
      entityId: eventId,
      metadata: { provider: endpoint.provider, callback: ev.eventType, outcome: reviewState },
    });
    return { kind: 'callback' };
  }

  // consent_or_optout / template_updated / account_state_changed / mailbox_changed
  // / attachment_received / unsupported_event — recorded by the external_events row.
  return { kind: 'noop' };
}

/**
 * Re-route a PRESERVED normalized event (replay execution, local/synchronous).
 * Loads the stored `external_events` row, reconstructs the normalized envelope, and
 * re-invokes the SAME routing through the SAME idempotency anchor (`idempotency_key`).
 * Because downstream services (`ingestLead`, `ingestConversationMessage`) are
 * idempotent on that key, a replay after success creates NO duplicate side effects,
 * while a replay after a failure completes the originally-missed work.
 */
export async function reprocessExternalEvent(
  admin: Admin,
  tenantId: string,
  eventId: string,
): Promise<{ ok: boolean; routed?: string; reason?: string }> {
  const { data: ev } = await admin
    .from('external_events')
    .select(
      'id, provider, connection_id, external_event_id, event_type, normalized_payload, payload_hash, idempotency_key, correlation_id, occurred_at, received_at, payload_version',
    )
    .eq('tenant_id', tenantId)
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return { ok: false, reason: 'not_found' };

  const endpoint: ResolvedEndpoint = {
    connectionId: (ev.connection_id as string) ?? '',
    tenantId,
    provider: ev.provider as IntegrationProvider,
    status: 'active',
    disabled: false,
    secretRef: null,
    verificationTokenRef: null,
    endpointActive: true,
    requiresSignature: false,
  };
  const now = new Date().toISOString();
  const norm = {
    tenantId,
    provider: ev.provider,
    integrationConnectionId: endpoint.connectionId,
    externalAccountId: undefined,
    externalEventId: ev.external_event_id as string,
    eventType: ev.event_type as string,
    occurredAt: (ev.occurred_at as string | null) ?? now,
    receivedAt: (ev.received_at as string | null) ?? now,
    subject: {},
    payloadVersion: (ev.payload_version as string | null) ?? '1',
    normalizedPayload: ev.normalized_payload ?? {},
    idempotencyKey: ev.idempotency_key as string,
    payloadHash: ev.payload_hash as string,
    correlationId: (ev.correlation_id as string | null) ?? 'replay',
  } as unknown as NormalizedExternalEvent;

  const routed = await routeEvent(admin, endpoint, norm, eventId, norm.correlationId);
  return { ok: true, routed: routed.kind };
}

/** Resolve a conversation/lead for an inbound message via external_identity_links. */
async function resolveIdentityConversation(
  admin: Admin,
  endpoint: ResolvedEndpoint,
  ev: NormalizedExternalEvent,
): Promise<{ conversationId: string | null; leadId: string | null }> {
  const identity =
    ev.subject.externalContactId ?? ev.subject.contactPhone ?? ev.subject.conversationRef ?? null;
  if (!identity) return { conversationId: null, leadId: null };
  const { data: link } = await admin
    .from('external_identity_links')
    .select('conversation_id, lead_id')
    .eq('tenant_id', endpoint.tenantId)
    .eq('provider', endpoint.provider)
    .eq('external_identity', identity)
    .maybeSingle();
  return {
    conversationId: (link?.conversation_id as string | null) ?? null,
    leadId: (link?.lead_id as string | null) ?? null,
  };
}

async function markLastSuccess(
  admin: Admin,
  tenantId: string,
  connectionId: string,
  now: Date,
): Promise<void> {
  await admin
    .from('integration_connections')
    .update({ last_success_at: now.toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', connectionId);
}
