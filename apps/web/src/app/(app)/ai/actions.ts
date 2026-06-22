'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  buildDeterministicSummary,
  detectLanguage,
  type ConvMessage,
  type SupportedLanguage,
} from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';
import { runAiAnswer, type AiRunResult } from '@/lib/ai/orchestrator';
import { runResponder } from '@/lib/ai/responder';
import { sendReplyAction } from '../inbox/actions';

/**
 * AI server actions (Phase 5A sections 22-25).
 *
 * ABSOLUTE INVARIANTS:
 *  - NO action here sends a customer message or mutates conversation state. The
 *    orchestrator only produces an AGENT-FACING draft + trace.
 *  - Sending an EDITED copilot draft is delegated to sendReplyAction, which
 *    independently enforces reply permission / status / consent / DNC / takeover.
 *    This file never bypasses it.
 *  - Every action is permission-gated and audited with ids + safe summaries only.
 *  - The AI summary preview is deterministic + preview-only (never saved), and
 *    excludes redacted/internal messages.
 */

const SUPPORTED: readonly SupportedLanguage[] = ['en', 'hi', 'kn', 'ta', 'te', 'hinglish'];

// --- Test Lab --------------------------------------------------------------

export interface TestLabState {
  ok?: boolean;
  error?: string;
  run?: {
    runId: string | null;
    draft: string;
    grounded: boolean;
    grounding: string;
    escalationCategory: string | null;
    escalationPriority: string;
    citations: { customerSafeReference: string }[];
    sufficiency: number;
    blockers: string[];
    providerStatus: AiRunResult['providerStatus'];
    maySendAutomatically: false;
  };
}

const testLabSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  question: z.string().min(1).max(2000),
  language: z.enum(SUPPORTED as [SupportedLanguage, ...SupportedLanguage[]]).optional(),
  mode: z.enum(['shadow', 'copilot']).default('copilot'),
});

/**
 * Run the orchestrator in the Test Lab (ai.test_lab.use). NEVER sends. Uses a
 * synthetic question; no real lead PII is required.
 */
export async function runTestLab(input: z.infer<typeof testLabSchema>): Promise<TestLabState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.test_lab.use')) {
    return { error: 'You do not have permission to use the AI test lab.' };
  }
  const parsed = testLabSchema.safeParse(input);
  if (!parsed.success) return { error: 'Enter a question.' };

  const language = parsed.data.language ?? detectLanguage(parsed.data.question);
  const result = await runAiAnswer({
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    mode: parsed.data.mode,
    projectId: parsed.data.projectId ?? null,
    question: parsed.data.question,
    language,
  });

  await writeAudit({
    action: 'AI_TEST_RUN_EXECUTED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_run',
    entityId: result.runId,
    metadata: {
      grounding: result.grounding,
      grounded: result.grounded,
      escalationCategory: result.escalation.escalate ? result.escalation.category : null,
    },
  });

  return {
    ok: true,
    run: {
      runId: result.runId,
      draft: result.draft,
      grounded: result.grounded,
      grounding: result.grounding,
      escalationCategory: result.escalation.escalate ? result.escalation.category : null,
      escalationPriority: result.escalation.priority,
      citations: result.citations.map((c) => ({ customerSafeReference: c.customerSafeReference })),
      sufficiency: result.retrievedChunkIds.length > 0 ? 1 : 0,
      blockers: result.blockers,
      providerStatus: result.providerStatus,
      maySendAutomatically: false,
    },
  };
}

// --- Copilot drafts --------------------------------------------------------

export interface CopilotDraftState {
  ok?: boolean;
  error?: string;
  draft?: {
    id: string;
    body: string;
    grounding: string;
    escalationCategory: string | null;
    citations: { customerSafeReference: string }[];
  };
}

const generateCopilotSchema = z.object({
  conversationId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  language: z.enum(SUPPORTED as [SupportedLanguage, ...SupportedLanguage[]]).optional(),
});

/**
 * Generate an agent-facing copilot draft for a conversation (ai.copilot.use). The
 * draft is stored in ai_copilot_drafts (status 'generated'). It is NEVER sent and
 * NEVER inserted as a conversation_message.
 */
export async function generateCopilotDraft(
  input: z.infer<typeof generateCopilotSchema>,
): Promise<CopilotDraftState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.copilot.use')) {
    return { error: 'You do not have permission to use copilot.' };
  }
  const parsed = generateCopilotSchema.safeParse(input);
  if (!parsed.success) return { error: 'Enter a question.' };

  const supabase = await createSupabaseServerClient();
  // Resolve the conversation's project + lead server-side (RLS-scoped).
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, lead_id, project_id')
    .eq('id', parsed.data.conversationId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!conv) return { error: 'Conversation not found.' };
  const c = conv as Record<string, unknown>;

  const language = parsed.data.language ?? detectLanguage(parsed.data.question);
  const result = await runAiAnswer(
    {
      tenantId: ctx.activeTenantId,
      actorUserId: ctx.userId,
      mode: 'copilot',
      projectId: (c.project_id as string | null) ?? null,
      question: parsed.data.question,
      language,
      conversationId: parsed.data.conversationId,
      leadId: (c.lead_id as string | null) ?? null,
    },
    supabase,
  );

  const { data: draftRow, error } = await supabase
    .from('ai_copilot_drafts')
    .insert({
      tenant_id: ctx.activeTenantId,
      conversation_id: parsed.data.conversationId,
      run_id: result.runId,
      body: result.draft,
      grounding_decision: result.grounding,
      escalation_category: result.escalation.escalate ? result.escalation.category : null,
      citations: result.citations.map((cit) => ({
        customerSafeReference: cit.customerSafeReference,
      })),
      status: 'generated',
    })
    .select('id')
    .single();
  if (error || !draftRow) return { error: 'Could not store the draft.' };
  const draftId = (draftRow as { id: string }).id;

  await writeAudit({
    action: 'AI_COPILOT_DRAFT_GENERATED',
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_copilot_draft',
    entityId: draftId,
    metadata: { grounding: result.grounding, runId: result.runId },
  });

  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return {
    ok: true,
    draft: {
      id: draftId,
      body: result.draft,
      grounding: result.grounding,
      escalationCategory: result.escalation.escalate ? result.escalation.category : null,
      citations: result.citations.map((cit) => ({
        customerSafeReference: cit.customerSafeReference,
      })),
    },
  };
}

const dispositionSchema = z.object({
  draftId: z.string().uuid(),
  disposition: z.enum(['accepted', 'edited', 'discarded']),
});

/** Record an agent's disposition of a copilot draft. Does NOT send anything. */
export async function dispositionDraft(input: z.infer<typeof dispositionSchema>): Promise<{
  ok?: boolean;
  error?: string;
}> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.copilot.use')) {
    return { error: 'You do not have permission to use copilot.' };
  }
  const parsed = dispositionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid disposition.' };

  const supabase = await createSupabaseServerClient();
  const { data: draft } = await supabase
    .from('ai_copilot_drafts')
    .select('id, conversation_id')
    .eq('id', parsed.data.draftId)
    .eq('tenant_id', ctx.activeTenantId)
    .maybeSingle();
  if (!draft) return { error: 'Draft not found.' };

  const { error } = await supabase
    .from('ai_copilot_drafts')
    .update({
      status: parsed.data.disposition,
      disposition_by: ctx.userId,
      disposition_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.draftId)
    .eq('tenant_id', ctx.activeTenantId);
  if (error) return { error: 'Could not record disposition.' };

  const auditAction =
    parsed.data.disposition === 'accepted'
      ? 'AI_COPILOT_DRAFT_ACCEPTED'
      : parsed.data.disposition === 'edited'
        ? 'AI_COPILOT_DRAFT_EDITED'
        : 'AI_COPILOT_DRAFT_DISCARDED';
  await writeAudit({
    action: auditAction,
    tenantId: ctx.activeTenantId,
    actorUserId: ctx.userId,
    entityType: 'ai_copilot_draft',
    entityId: parsed.data.draftId,
  });

  const convId = (draft as { conversation_id: string }).conversation_id;
  revalidatePath(`/inbox/${convId}`);
  return { ok: true };
}

/**
 * Send an EDITED copilot draft. This delegates ENTIRELY to sendReplyAction, the
 * single human-initiated outbound path that enforces reply-permission, status,
 * consent and DNC. There is NO AI send path here - this is a human action sending
 * human-reviewed text.
 */
export async function sendEditedDraft(
  conversationId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.set('conversationId', conversationId);
  fd.set('body', body);
  const res = await sendReplyAction({}, fd);
  return { ok: Boolean(res.ok), error: res.error };
}

// --- AI summary preview ----------------------------------------------------

export interface AiSummaryPreviewState {
  ok?: boolean;
  error?: string;
  preview?: {
    summary: string;
    unansweredQuestion: string | null;
    recommendedNextAction: string;
    messageCount: number;
    /** Inclusive message-id range the preview was computed over (provenance). */
    fromMessageId: string | null;
    toMessageId: string | null;
    /** Always false - a preview is never persisted in Phase 5A. */
    saved: false;
  };
}

/**
 * Generate a DETERMINISTIC AI summary PREVIEW for a conversation (ai.copilot.use).
 *
 * SAFETY: preview only - it is NOT saved, never updates lead fields or scores,
 * excludes redacted + internal messages, and cites the message-id range used.
 * Uses the deterministic domain summary (mock-grade), never an external provider.
 */
export async function generateAiSummaryPreview(
  conversationId: string,
): Promise<AiSummaryPreviewState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.copilot.use')) {
    return { error: 'You do not have permission to use copilot.' };
  }
  if (!z.string().uuid().safeParse(conversationId).success) {
    return { error: 'Invalid conversation.' };
  }

  const supabase = await createSupabaseServerClient();
  // RLS-scoped read; exclude redacted + internal messages (visibility-respecting).
  const { data: rows } = await supabase
    .from('conversation_messages')
    .select('id, direction, sender, body, redacted, created_at')
    .eq('conversation_id', conversationId)
    .eq('tenant_id', ctx.activeTenantId)
    .neq('direction', 'internal')
    .order('created_at', { ascending: true })
    .limit(500);
  const all = (rows ?? []) as {
    id: string;
    direction: string;
    sender: string;
    body: string | null;
    redacted: boolean | null;
    created_at: string;
  }[];
  const visible = all.filter((m) => !m.redacted && (m.body ?? '').trim() !== '');

  const messages: ConvMessage[] = visible.map((m) => ({
    direction: m.direction as ConvMessage['direction'],
    sender: m.sender as ConvMessage['sender'],
    body: m.body,
    createdAt: m.created_at,
  }));
  const summary = buildDeterministicSummary(messages);

  return {
    ok: true,
    preview: {
      summary: summary.summary,
      unansweredQuestion: summary.unansweredQuestion,
      recommendedNextAction: summary.recommendedNextAction,
      messageCount: summary.messageCount,
      fromMessageId: visible[0]?.id ?? null,
      toMessageId: visible[visible.length - 1]?.id ?? null,
      saved: false,
    },
  };
}

export interface ResponderState {
  ok?: boolean;
  error?: string;
  outcome?: string;
  reason?: string;
  /** Always false in this phase — the responder never sends. */
  delivered?: false;
}

/**
 * Run the Phase-5B automatic responder for a conversation (behind the boundary).
 * Records what the responder WOULD do; it NEVER sends a customer message.
 * Gated by `ai.shadow.manage` (an internal/operator capability).
 */
export async function runResponderAction(conversationId: string): Promise<ResponderState> {
  const ctx = await getAppContext();
  if (!ctx.activeTenantId || !ensurePermission(ctx, 'ai.shadow.manage')) {
    return { error: 'You do not have permission to run the responder.' };
  }
  if (!z.string().uuid().safeParse(conversationId).success) {
    return { error: 'Invalid conversation.' };
  }
  const supabase = await createSupabaseServerClient();
  const { decision } = await runResponder(conversationId, ctx.activeTenantId, supabase);
  return {
    ok: true,
    outcome: decision.outcome,
    reason: decision.reason,
    delivered: false,
  };
}
