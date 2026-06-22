import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeSlaAdmin } from '@/app/(app)/inbox/sla';

/**
 * Canonical conversation-message ingestion — the SINGLE server path for every
 * inbound channel (website chat, WhatsApp/email/partner fixtures, and future
 * live channels). Integration routers MUST call this instead of inserting into
 * `conversation_messages` directly.
 *
 * Persist-before-process + idempotent lifecycle:
 *   1. Persist `message_ingestion_events` (UNIQUE (tenant, idempotency_key)).
 *   2. A duplicate returns the EXISTING result with no repeated downstream effect.
 *   3. Persist a processing attempt.
 *   4. Insert `conversation_messages` (idempotent on `external_message_id`); the
 *      DB trigger (migration 0013) emits the initial delivery event and
 *      recomputes waiting-on/unread.
 *   5. Mark the ingestion event completed (+ resulting message id).
 *   6. Recompute SLA via the existing `recomputeSlaAdmin`.
 * Never sends anything; never bypasses the Phase 5B AI delivery constraints.
 */

export interface IngestConversationMessageInput {
  tenantId: string;
  conversationId: string;
  leadId?: string | null;
  widgetId?: string | null;
  body: string | null;
  language?: string | null;
  externalMessageId?: string | null;
  idempotencyKey: string;
  payloadHash: string;
  direction?: 'inbound' | 'outbound';
  sender?: 'lead' | 'agent' | 'ai' | 'system';
  correlationId?: string | null;
  /** Links the resulting state back to the originating external event row. */
  externalEventId?: string | null;
}

export interface IngestConversationMessageResult {
  ok: boolean;
  duplicate: boolean;
  messageId: string | null;
  ingestionEventId: string | null;
  error?: string;
}

export async function ingestConversationMessage(
  input: IngestConversationMessageInput,
  admin: SupabaseClient,
): Promise<IngestConversationMessageResult> {
  const { tenantId, conversationId } = input;

  const { data: event, error: evErr } = await admin
    .from('message_ingestion_events')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      widget_id: input.widgetId ?? null,
      external_message_id: input.externalMessageId ?? null,
      idempotency_key: input.idempotencyKey,
      payload_hash: input.payloadHash,
      status: 'received',
      correlation_id: input.correlationId ?? null,
    })
    .select('id')
    .single();

  if (evErr) {
    if ((evErr as { code?: string }).code === '23505') {
      // Duplicate authenticated message — return the existing result, no re-run.
      const { data: existing } = await admin
        .from('message_ingestion_events')
        .select('id, resulting_message_id')
        .eq('tenant_id', tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      return {
        ok: true,
        duplicate: true,
        messageId: (existing?.resulting_message_id as string | null) ?? null,
        ingestionEventId: (existing?.id as string | null) ?? null,
      };
    }
    return {
      ok: false,
      duplicate: false,
      messageId: null,
      ingestionEventId: null,
      error: 'ingestion_event_failed',
    };
  }

  const ingestionEventId = event.id as string;
  await admin
    .from('message_ingestion_events')
    .update({ status: 'processing' })
    .eq('id', ingestionEventId);
  await admin.from('message_processing_attempts').insert({
    tenant_id: tenantId,
    ingestion_event_id: ingestionEventId,
    attempt_no: 1,
    status: 'processing',
  });

  const { data: msg, error: msgErr } = await admin
    .from('conversation_messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      lead_id: input.leadId ?? null,
      direction: input.direction ?? 'inbound',
      sender: input.sender ?? 'lead',
      body: input.body,
      language: input.language ?? null,
      status: 'received',
      external_message_id: input.externalMessageId ?? null,
    })
    .select('id')
    .single();

  // 23505 = an idempotent duplicate append (message already present): not an error.
  if (msgErr && (msgErr as { code?: string }).code !== '23505') {
    await admin
      .from('message_ingestion_events')
      .update({ status: 'retry_scheduled', last_error_code: 'insert_failed' })
      .eq('id', ingestionEventId);
    return {
      ok: false,
      duplicate: false,
      messageId: null,
      ingestionEventId,
      error: 'message_insert_failed',
    };
  }

  const messageId = (msg?.id as string | null) ?? null;
  await admin
    .from('message_ingestion_events')
    .update({
      status: 'completed',
      resulting_message_id: messageId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', ingestionEventId);

  await recomputeSlaAdmin(conversationId, tenantId, {
    reason: 'inbound_message',
    correlationId: input.correlationId ?? undefined,
  });

  return { ok: true, duplicate: false, messageId, ingestionEventId };
}
