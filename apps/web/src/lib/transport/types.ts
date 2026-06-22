/**
 * Provider-neutral conversation transport (Phase 4.1, Priority 2).
 *
 * The polling implementation backs this today; a Supabase Realtime adapter can
 * implement the same interface later without touching call sites. Polling is
 * never presented as realtime, and there are no fake typing/presence signals.
 */

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'expired';

export interface TransportMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound' | 'internal';
  sender: 'lead' | 'agent' | 'ai' | 'system';
  body: string | null;
  redacted: boolean;
  createdAt: string;
}

export interface MessagePage {
  messages: TransportMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
}
export interface SendMessageResult {
  ok: boolean;
  error?: string;
}

export interface MarkReadInput {
  conversationId: string;
  lastReadMessageId?: string;
}

export type MessageHandler = (page: MessagePage, state: ConnectionState) => void;
export type Unsubscribe = () => void;

export interface SubscribeOptions {
  /**
   * Opaque cursor of the last already-rendered (server-side) message. When
   * provided, the first poll fetches only messages strictly after it, so the
   * server-rendered page is never re-sent to the client.
   */
  initialCursor?: string;
  /** Base polling interval override (e.g. slower for closed conversations). */
  baseIntervalMs?: number;
  /** Stop polling entirely after the first reconciling fetch (closed/archived). */
  pollOnce?: boolean;
}

export interface ConversationTransport {
  subscribe(conversationId: string, handler: MessageHandler, opts?: SubscribeOptions): Unsubscribe;
  fetchSince(conversationId: string, cursor?: string): Promise<MessagePage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  markRead(input: MarkReadInput): Promise<void>;
}
