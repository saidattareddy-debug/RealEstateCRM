/**
 * Deterministic inbox logic (Phase 4.1). Pure, framework- and DB-independent.
 * - Waiting-on state from real message direction/status.
 * - Message delivery transition validator.
 * - Safe canned-reply variable substitution (no eval, allow-list only).
 * - Response-SLA status.
 */

import type { Lifecycle } from './ai-guard';

// ---------------------------------------------------------------------------
// Waiting-on
// ---------------------------------------------------------------------------

export type WaitingOn = 'agent' | 'lead' | 'system' | 'none';

export interface WaitingMessage {
  direction: 'inbound' | 'outbound' | 'internal';
  sender: 'lead' | 'agent' | 'ai' | 'system';
  failed?: boolean;
}

/**
 * Determine who the conversation is waiting on. Internal notes never change the
 * waiting state. A failed outbound message still leaves the agent owing a reply.
 * Terminal lifecycles wait on no one.
 */
export function computeWaitingOn(
  lifecycle: Lifecycle,
  messages: readonly WaitingMessage[],
): WaitingOn {
  if (
    lifecycle === 'closed' ||
    lifecycle === 'resolved' ||
    lifecycle === 'archived' ||
    lifecycle === 'spam'
  ) {
    return 'none';
  }
  // Ignore internal notes — they are not part of the customer exchange.
  const relevant = messages.filter((m) => m.direction !== 'internal');
  const last = relevant[relevant.length - 1];
  if (!last) return 'none';
  if (last.sender === 'system') return 'system';
  if (last.direction === 'inbound') return 'agent';
  // outbound (agent/ai)
  if (last.failed) return 'agent'; // delivery failed → still owe the lead a reply
  return 'lead';
}

// ---------------------------------------------------------------------------
// Message delivery transitions
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | 'received'
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled';

const DELIVERY_GRAPH: Record<DeliveryStatus, DeliveryStatus[]> = {
  received: ['pending', 'queued', 'failed', 'cancelled'],
  pending: ['queued', 'sent', 'failed', 'cancelled'],
  queued: ['sent', 'failed', 'cancelled'],
  sent: ['delivered', 'read', 'failed'],
  delivered: ['read', 'failed'],
  read: [],
  failed: ['queued', 'pending'], // retry path
  cancelled: [],
};

/** True iff `to` is a legal next delivery status after `from`. */
export function validateDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  if (from === to) return false;
  return DELIVERY_GRAPH[from].includes(to);
}

// ---------------------------------------------------------------------------
// Canned replies — safe variable substitution
// ---------------------------------------------------------------------------

export const CANNED_VARIABLES = [
  'lead_name',
  'agent_name',
  'project_name',
  'project_location',
  'site_address',
  'contact_number',
] as const;
export type CannedVariable = (typeof CANNED_VARIABLES)[number];

export interface CannedResolveResult {
  ok: boolean;
  text: string | null;
  error: string | null;
  unknownVariables: string[];
}

/**
 * Resolve `{{variable}}` tokens against an allow-list ONLY. Unknown variables
 * are rejected (never echoed). No HTML, no template evaluation, no JS — the body
 * is treated as plain text and only the known tokens are replaced.
 */
export function resolveCannedReply(
  body: string,
  values: Partial<Record<CannedVariable, string>>,
): CannedResolveResult {
  const tokenRe = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const unknown = new Set<string>();
  for (const m of body.matchAll(tokenRe)) {
    const name = m[1] ?? '';
    if (!(CANNED_VARIABLES as readonly string[]).includes(name)) unknown.add(name);
  }
  if (unknown.size > 0) {
    return {
      ok: false,
      text: null,
      error: `Unknown variable(s): ${[...unknown].join(', ')}`,
      unknownVariables: [...unknown],
    };
  }
  const text = body.replace(tokenRe, (_full, name: string) => {
    const v = values[name as CannedVariable];
    return v == null ? '' : String(v);
  });
  return { ok: true, text, error: null, unknownVariables: [] };
}

// ---------------------------------------------------------------------------
// Unread derivation
// ---------------------------------------------------------------------------

export interface UnreadMessage {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  sender: 'lead' | 'agent' | 'ai' | 'system';
  redacted?: boolean;
  createdAt: string;
}

/**
 * Derive an internal user's unread count: customer-facing inbound messages newer
 * than their last-read marker. Internal notes and system messages never count;
 * redacted messages are counted (they exist) but never leak a preview. This is
 * derived from the message/read data, not a mutable global counter.
 */
export function deriveUnread(
  messages: readonly UnreadMessage[],
  lastReadAt: string | null,
): number {
  const cutoff = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  return messages.filter(
    (m) =>
      m.direction === 'inbound' && m.sender === 'lead' && new Date(m.createdAt).getTime() > cutoff,
  ).length;
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export interface OwnerMismatch {
  mismatch: boolean;
  conversationOwner: string | null;
  leadOwner: string | null;
}

/** Detect a conversation-vs-lead owner mismatch (never resolved silently). */
export function detectOwnerMismatch(
  conversationOwner: string | null,
  leadOwner: string | null,
): OwnerMismatch {
  const mismatch =
    conversationOwner != null && leadOwner != null && conversationOwner !== leadOwner;
  return { mismatch, conversationOwner, leadOwner };
}

// ---------------------------------------------------------------------------
// Search snippets
// ---------------------------------------------------------------------------

/**
 * Build a safe plain-text snippet around the first case-insensitive match of
 * `query` in `text`. Returns plain text only (no HTML / markup), so it cannot
 * inject markup when rendered; the caller highlights via the returned
 * `matchStart`/`matchEnd` offsets within the snippet. Redacted bodies should be
 * excluded by the caller before this is invoked.
 */
export interface Snippet {
  text: string;
  matchStart: number;
  matchEnd: number;
}

export function buildSnippet(text: string, query: string, radius = 40): Snippet {
  const clean = text.replace(/\s+/g, ' ').trim();
  const q = query.trim();
  if (q === '') return { text: clean.slice(0, radius * 2), matchStart: 0, matchEnd: 0 };
  const idx = clean.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return { text: clean.slice(0, radius * 2), matchStart: 0, matchEnd: 0 };
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + q.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  const snippet = prefix + clean.slice(start, end) + suffix;
  const matchStart = prefix.length + (idx - start);
  return { text: snippet, matchStart, matchEnd: matchStart + q.length };
}

// ---------------------------------------------------------------------------
// Response SLA
// ---------------------------------------------------------------------------

export type SlaStatus = 'on_track' | 'due_soon' | 'breached' | 'paused';

export interface SlaInput {
  dueAt: string | null;
  firstResponseAt: string | null;
  lifecycle: Lifecycle;
  waitingOn: WaitingOn;
  now: Date;
  dueSoonMinutes?: number;
}

/**
 * SLA status. Paused while waiting on the lead or in a non-active lifecycle
 * (resolved/closed/archived/spam). Working-hour exclusion is applied upstream
 * when computing `dueAt`; this function is the deterministic status mapping.
 */
export function computeSlaStatus(input: SlaInput): SlaStatus {
  const { dueAt, firstResponseAt, lifecycle, waitingOn, now } = input;
  if (
    waitingOn === 'lead' ||
    lifecycle === 'resolved' ||
    lifecycle === 'closed' ||
    lifecycle === 'archived' ||
    lifecycle === 'spam' ||
    lifecycle === 'paused'
  ) {
    return 'paused';
  }
  if (firstResponseAt || !dueAt) return 'on_track';
  const due = new Date(dueAt).getTime();
  const soon = (input.dueSoonMinutes ?? 5) * 60_000;
  if (now.getTime() >= due) return 'breached';
  if (now.getTime() >= due - soon) return 'due_soon';
  return 'on_track';
}
