/**
 * Conversation domain logic (Phase 4). Pure, framework- and DB-independent.
 * - Deterministic conversation summary (AI summaries arrive in Phase 5).
 * - Consent / do-not-contact (DNC) enforcement for outbound messaging.
 * - "Needs response" / SLA computation for the inbox.
 */

export type MsgDirection = 'inbound' | 'outbound' | 'internal';
export type MsgSender = 'lead' | 'agent' | 'ai' | 'system';

export interface ConvMessage {
  direction: MsgDirection;
  sender: MsgSender;
  body: string | null;
  createdAt: string; // ISO
}

export interface DeterministicSummary {
  summary: string;
  unansweredQuestion: string | null;
  recommendedNextAction: string;
  messageCount: number;
}

const isQuestion = (s: string) => /\?\s*$/.test(s.trim());

/**
 * Build a deterministic, explainable summary from the message log. This is a
 * factual roll-up — it never invents content and never answers on behalf of the
 * lead (AI-generated summaries are a separate, Phase-5 source).
 */
export function buildDeterministicSummary(messages: readonly ConvMessage[]): DeterministicSummary {
  const withBody = messages.filter((m) => (m.body ?? '').trim() !== '');
  const messageCount = withBody.length;
  const last = withBody[withBody.length - 1];
  const lastInbound = [...withBody].reverse().find((m) => m.direction === 'inbound') ?? null;

  // An inbound question is "unanswered" only if nothing outbound followed it.
  let unansweredQuestion: string | null = null;
  if (lastInbound && isQuestion(lastInbound.body ?? '')) {
    const idx = withBody.lastIndexOf(lastInbound);
    const answeredAfter = withBody.slice(idx + 1).some((m) => m.direction === 'outbound');
    if (!answeredAfter) unansweredQuestion = (lastInbound.body ?? '').trim();
  }

  const inbound = withBody.filter((m) => m.direction === 'inbound').length;
  const outbound = withBody.filter((m) => m.direction === 'outbound').length;

  let recommendedNextAction: string;
  if (messageCount === 0) recommendedNextAction = 'Start the conversation.';
  else if (last && last.direction === 'inbound')
    recommendedNextAction = unansweredQuestion
      ? 'Answer the open question from the lead.'
      : 'Reply to the latest message from the lead.';
  else recommendedNextAction = 'Awaiting the lead — follow up if no reply.';

  const summary =
    messageCount === 0
      ? 'No messages yet.'
      : `${messageCount} message(s): ${inbound} inbound, ${outbound} outbound.` +
        (lastInbound ? ` Last from lead: "${truncate(lastInbound.body ?? '', 140)}".` : '');

  return { summary, unansweredQuestion, recommendedNextAction, messageCount };
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

// ---------------------------------------------------------------------------
// Consent / Do-Not-Contact
// ---------------------------------------------------------------------------

export type ConsentChannel = 'whatsapp' | 'email' | 'sms' | 'call' | 'any';
export type ConsentStatus = 'granted' | 'revoked' | 'do_not_contact';

export interface ConsentRecord {
  channel: ConsentChannel;
  status: ConsentStatus;
}

export interface ContactDecision {
  contactable: boolean;
  reason: string | null;
}

/**
 * Decide whether an outbound message may be sent on a channel. A `revoked` or
 * `do_not_contact` record for the channel — or for `any` — blocks contact.
 * Absence of a record means contactable (consent is captured elsewhere).
 */
export function isContactable(
  consents: readonly ConsentRecord[],
  channel: Exclude<ConsentChannel, 'any'>,
): ContactDecision {
  const applies = (c: ConsentRecord) => c.channel === channel || c.channel === 'any';
  const blocking = consents.find((c) => applies(c) && c.status !== 'granted');
  if (blocking) {
    return {
      contactable: false,
      reason:
        blocking.status === 'do_not_contact'
          ? `Do-not-contact set for ${blocking.channel}.`
          : `Consent revoked for ${blocking.channel}.`,
    };
  }
  return { contactable: true, reason: null };
}

// ---------------------------------------------------------------------------
// Needs-response / SLA
// ---------------------------------------------------------------------------

export interface ConversationState {
  status: 'open' | 'snoozed' | 'closed';
  lastInboundAt: string | null;
  lastMessageAt: string | null;
}

export interface ResponseSla {
  needsResponse: boolean;
  overdue: boolean;
  waitingMinutes: number | null;
}

/**
 * A conversation needs a response when it is open and the most recent activity
 * was an inbound message (i.e. the lead is waiting). Overdue once the wait
 * exceeds `slaMinutes`.
 */
export function needsResponse(conv: ConversationState, now: Date, slaMinutes = 15): ResponseSla {
  if (conv.status !== 'open' || !conv.lastInboundAt) {
    return { needsResponse: false, overdue: false, waitingMinutes: null };
  }
  const inbound = new Date(conv.lastInboundAt).getTime();
  const lastMsg = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : inbound;
  // If an outbound message followed the inbound, no response is owed.
  if (lastMsg > inbound) return { needsResponse: false, overdue: false, waitingMinutes: null };

  const waitingMinutes = Math.max(0, Math.floor((now.getTime() - inbound) / 60000));
  return { needsResponse: true, overdue: waitingMinutes >= slaMinutes, waitingMinutes };
}
