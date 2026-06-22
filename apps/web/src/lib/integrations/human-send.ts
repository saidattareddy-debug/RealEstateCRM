import 'server-only';
import {
  evaluateWhatsAppPolicy,
  type IntegrationProvider,
  type WhatsAppPolicyState,
} from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit-service';

const SESSION_WINDOW_HOURS = 24;

export interface HumanSendInput {
  tenantId: string;
  actorUserId: string;
  conversationId: string;
  channel: IntegrationProvider;
  body: string;
  templateId?: string | null;
  templateVariables?: Record<string, string>;
  idempotencyKey: string;
}

export interface HumanSendPreview {
  ok: boolean;
  /** Always true — Phase 7A is a simulation, nothing is ever sent. */
  simulated: true;
  blocked: boolean;
  reason: string;
  policyState?: WhatsAppPolicyState;
  /** Safe redacted preview of what WOULD be sent (never delivered). */
  preview: string;
  requestId?: string;
}

/**
 * Human outbound SIMULATION (Phase 7A). Enforces the same gates a live send
 * would (visibility, open conversation, consent/DNC/opt-out, channel enabled,
 * WhatsApp session/template policy, template variables, idempotency) but creates
 * ONLY simulation records. There is no external IO, no provider reference, and no
 * delivered state — the DB CHECK (`simulated = true`) makes a real send
 * impossible. Returns a safe preview.
 */
export async function simulateHumanSend(input: HumanSendInput): Promise<HumanSendPreview> {
  const admin = createSupabaseAdminClient();
  const { tenantId } = input;

  const block = (reason: string, policyState?: WhatsAppPolicyState): HumanSendPreview => ({
    ok: false,
    simulated: true,
    blocked: true,
    reason,
    policyState,
    preview: '',
  });

  if (!input.body || input.body.trim().length === 0) return block('empty_body');

  // Conversation visibility + open state.
  const { data: conv } = await admin
    .from('conversations')
    .select('id, lead_id, status, lifecycle, last_inbound_at')
    .eq('tenant_id', tenantId)
    .eq('id', input.conversationId)
    .maybeSingle();
  if (!conv) return block('conversation_not_found');
  const lifecycle = (conv.lifecycle as string | null) ?? (conv.status as string | null);
  if (lifecycle === 'closed' || conv.status === 'closed') return block('conversation_closed');

  // Consent / DNC / opt-out for the lead on this channel. Safe-by-default: a
  // withdrawn consent or an active DNC entry blocks. (Reuses the inbox consent
  // model — contact_consents.status + do_not_contact_entries.active.)
  const leadId = conv.lead_id as string | null;
  const channelEnum = input.channel === 'whatsapp_cloud' ? 'whatsapp' : 'email';
  let consentGranted = true;
  let dncActive = false;
  const optedOut = false;
  if (leadId) {
    const { data: consent } = await admin
      .from('contact_consents')
      .select('channel, status')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId);
    for (const c of consent ?? []) {
      const ch = c.channel as string;
      if (ch !== 'any' && ch !== channelEnum) continue;
      if ((c.status as string) === 'withdrawn' || (c.status as string) === 'revoked') {
        consentGranted = false;
      }
    }
    const { count: dncCount } = await admin
      .from('do_not_contact_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId)
      .eq('active', true);
    if ((dncCount ?? 0) > 0) dncActive = true;
  }

  // Channel enabled?
  const { data: channel } = await admin
    .from('communication_channels')
    .select('enabled')
    .eq('tenant_id', tenantId)
    .eq('channel_kind', input.channel)
    .maybeSingle();
  const channelEnabled = channel ? Boolean(channel.enabled) : false;

  // WhatsApp session/template policy.
  let policyState: WhatsAppPolicyState | undefined;
  if (input.channel === 'whatsapp_cloud') {
    policyState = evaluateWhatsAppPolicy({
      lastCustomerInboundAt: (conv.last_inbound_at as string | null) ?? undefined,
      now: new Date(),
      sessionWindowHours: SESSION_WINDOW_HOURS,
      consentGranted,
      dncActive,
      optedOut,
      providerAvailable: channelEnabled,
      policyKnown: true,
    });
    if (policyState === 'dnc_blocked') return block('dnc_or_optout', policyState);
    if (policyState === 'consent_blocked') return block('consent_required', policyState);
    if (policyState === 'provider_unavailable') return block('channel_disabled', policyState);
    if (policyState === 'approved_template_required' && !input.templateId) {
      return block('template_required', policyState);
    }
  } else {
    if (optedOut || dncActive) return block('dnc_or_optout');
    if (!consentGranted) return block('consent_required');
  }

  // Template requirement + variables (when a template is referenced).
  if (input.templateId) {
    const { data: tmpl } = await admin
      .from('whatsapp_message_templates')
      .select('id, status, name')
      .eq('tenant_id', tenantId)
      .eq('id', input.templateId)
      .maybeSingle();
    if (!tmpl) return block('template_not_found', policyState);
    if ((tmpl.status as string) !== 'approved') return block('template_not_approved', policyState);
    const { data: version } = await admin
      .from('whatsapp_template_versions')
      .select('variable_schema')
      .eq('tenant_id', tenantId)
      .eq('template_id', input.templateId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const schema = (version?.variable_schema ?? {}) as Record<string, unknown>;
    const required = Object.keys(schema);
    const provided = input.templateVariables ?? {};
    const missing = required.filter((k) => !(k in provided) || provided[k]?.trim() === '');
    if (missing.length > 0) return block('template_variables_missing', policyState);
  }

  // Idempotency: a prior request with the same key returns the prior simulation.
  const { data: existingReq } = await admin
    .from('human_outbound_requests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existingReq) {
    return {
      ok: true,
      simulated: true,
      blocked: false,
      reason: 'idempotent_replay',
      policyState,
      preview: buildPreview(input.body),
      requestId: existingReq.id as string,
    };
  }

  // Create the request + attempt + simulation. State is `simulated`, never
  // `delivered`; there is NO provider reference column to populate.
  const { data: req, error: reqErr } = await admin
    .from('human_outbound_requests')
    .insert({
      tenant_id: tenantId,
      conversation_id: input.conversationId,
      channel: input.channel,
      requested_by: input.actorUserId,
      body: input.body,
      template_id: input.templateId ?? null,
      idempotency_key: input.idempotencyKey,
      state: 'simulated',
    })
    .select('id')
    .single();
  if (reqErr || !req) {
    // Unique violation == concurrent idempotent submit; treat as accepted.
    if (reqErr?.code === '23505') {
      return {
        ok: true,
        simulated: true,
        blocked: false,
        reason: 'idempotent_replay',
        policyState,
        preview: buildPreview(input.body),
      };
    }
    return block('persist_failed', policyState);
  }
  const requestId = req.id as string;

  await admin.from('human_outbound_attempts').insert({
    tenant_id: tenantId,
    request_id: requestId,
    attempt_no: 1,
    state: 'simulated',
  });
  await admin.from('human_outbound_simulations').insert({
    tenant_id: tenantId,
    request_id: requestId,
    simulated: true,
    preview: buildPreview(input.body),
    reason: policyState ?? 'simulation_only',
  });

  await writeAudit({
    action: 'INTEGRATION_HUMAN_MESSAGE_SIMULATED',
    tenantId,
    actorUserId: input.actorUserId,
    entityType: 'conversation',
    entityId: input.conversationId,
    metadata: {
      channel: input.channel,
      requestId,
      templateId: input.templateId ?? null,
      policyState: policyState ?? null,
      simulated: true,
    },
  });

  return {
    ok: true,
    simulated: true,
    blocked: false,
    reason: 'simulated_not_sent',
    policyState,
    preview: buildPreview(input.body),
    requestId,
  };
}

/** A safe, length-capped preview of the message body (never delivered). */
function buildPreview(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
}
