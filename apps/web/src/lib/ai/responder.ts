import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideResponderOutcome,
  RESPONDER_LIVE_SENDING,
  type ResponderDecision,
  type SupportedLanguage,
  type OperatingMode,
  type Lifecycle,
} from '@re/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runAiAnswer } from '@/lib/ai/orchestrator';

/**
 * Phase 5B responder — behind the safety boundary.
 *
 * On an AI-mode conversation this runs the full pipeline (retrieval → grounding →
 * mock generation via the orchestrator) and records what the automatic responder
 * WOULD do in `ai_responder_decisions`. It NEVER:
 *   - inserts a `conversation_messages` row,
 *   - creates a delivery event,
 *   - changes `waiting_on`, unread state, conversation status, or `ai_active`,
 *   - touches lead fields, pipeline stage, scores, or automations.
 *
 * Delivery is impossible: `RESPONDER_LIVE_SENDING` is a compile-time `false`, the
 * decision can never be `deliver`, and the DB CHECK on `ai_responder_decisions`
 * rejects a delivered outcome. Turning on live sending is a separate, reviewed,
 * credentialed production step.
 */

export interface ResponderResult {
  decision: ResponderDecision;
  runId: string | null;
  recorded: boolean;
}

export async function runResponder(
  conversationId: string,
  tenantId: string,
  client?: SupabaseClient,
): Promise<ResponderResult> {
  const supabase = client ?? createSupabaseAdminClient();

  const { data: conv } = await supabase
    .from('conversations')
    .select(
      'id, tenant_id, status, operating_mode, ai_active, human_takeover_at, language, lead_id, project_id, channel',
    )
    .eq('id', conversationId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!conv) {
    return {
      decision: {
        outcome: 'blocked',
        reason: 'blocked:conversation_not_found',
        liveSendingEnabled: RESPONDER_LIVE_SENDING,
        blockers: ['conversation_not_open'],
        delivered: false,
      },
      runId: null,
      recorded: false,
    };
  }

  const leadId = (conv.lead_id as string | null) ?? null;
  const projectId = (conv.project_id as string | null) ?? null;

  // Latest inbound customer message = the question the responder would answer.
  const { data: lastInbound } = await supabase
    .from('conversation_messages')
    .select('body')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const question = ((lastInbound?.body as string | null) ?? '').trim();

  // Consent / DNC state (safe-by-default: treat presence of a DNC entry / a
  // withdrawn consent as a block).
  const [{ count: dncCount }, { data: tenantPolicy }, { data: embCfg }] = await Promise.all([
    leadId
      ? supabase
          .from('do_not_contact_entries')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('lead_id', leadId)
          .eq('active', true)
      : Promise.resolve({ count: 0 }),
    supabase
      .from('ai_feature_policies')
      .select('operating_level')
      .eq('tenant_id', tenantId)
      .is('project_id', null)
      .maybeSingle(),
    supabase
      .from('embedding_model_configs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .limit(1)
      .maybeSingle(),
  ]);

  let consentWithdrawn = false;
  if (leadId) {
    const { data: consent } = await supabase
      .from('consent_events')
      .select('type')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    consentWithdrawn = String(consent?.type ?? '').includes('withdrawn');
  }

  // Run the pipeline in SHADOW mode (internal eval; the orchestrator itself
  // never sends). The mock provider is used unless a vetted adapter is wired.
  const run = await runAiAnswer(
    {
      tenantId,
      actorUserId: '00000000-0000-0000-0000-000000000000',
      mode: 'shadow',
      projectId,
      question: question || ' ',
      language: (conv.language as SupportedLanguage | null) ?? undefined,
      conversationId,
      leadId,
    },
    supabase,
  );

  const decision = decideResponderOutcome({
    operatingMode: (conv.operating_mode as OperatingMode | null) ?? 'human',
    takeoverActive: Boolean(conv.human_takeover_at),
    lifecycle: (String(conv.status) === 'open' ? 'open' : 'closed') as Lifecycle,
    dncBlocked: (dncCount ?? 0) > 0,
    consentWithdrawn,
    platformAiEnabled: true,
    tenantAiEnabled: String(tenantPolicy?.operating_level ?? 'disabled') !== 'disabled',
    projectAiApproved: true,
    channelPolicyAllows: true,
    providerAvailable: true,
    dailyLimitReached: false,
    modelConfigured: Boolean(embCfg?.id),
    knowledgeApproved: run.grounded,
    grounding: run.grounding,
    hasCandidate: run.grounded,
  });

  // Record the (non-sent) decision. NEVER insert a customer message / delivery /
  // waiting-on / status change here.
  await supabase.from('ai_responder_decisions').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    lead_id: leadId,
    project_id: projectId,
    run_id: run.runId,
    outcome: decision.outcome, // CHECK forbids 'deliver'
    reason: decision.reason,
    candidate_body: decision.outcome === 'suppressed' ? run.draft : null,
    gates: { blockers: decision.blockers, grounding: run.grounding },
    correlation_id: run.runId,
  });

  // An escalation/blocked decision creates an internal recommendation only.
  if (decision.outcome === 'escalate' || decision.outcome === 'blocked') {
    await supabase.from('ai_escalation_decisions').insert({
      tenant_id: tenantId,
      run_id: run.runId,
      conversation_id: conversationId,
      lead_id: leadId,
      project_id: projectId,
      category: run.escalation.category,
      reason: decision.reason,
      suggested_action: run.escalation.suggestedAgentAction,
      priority: run.escalation.priority,
      status: 'open',
      correlation_id: run.runId,
    });
  }

  return { decision, runId: run.runId, recorded: true };
}
