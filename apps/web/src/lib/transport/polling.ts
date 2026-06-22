'use client';

import { reconcileFetch, nextPollDelay, type PollLoopState } from '@re/domain';
import { fetchSinceAction, markReadViaTransport } from '@/app/(app)/inbox/transport-actions';
import { sendReplyFromTransport } from '@/app/(app)/inbox/transport-send';
import type {
  ConversationTransport,
  MessageHandler,
  MessagePage,
  SendMessageInput,
  SendMessageResult,
  MarkReadInput,
  Unsubscribe,
  ConnectionState,
  SubscribeOptions,
} from './types';

export interface PollingDeps {
  fetchSince?: (conversationId: string, cursor?: string) => Promise<MessagePage>;
  send?: (conversationId: string, body: string) => Promise<SendMessageResult>;
  markRead?: (conversationId: string, lastReadMessageId?: string) => Promise<void>;
}

export interface PollingOptions {
  baseIntervalMs?: number;
  /** Multiply the interval when the tab is hidden (slower polling). */
  hiddenMultiplier?: number;
  maxBackoffMs?: number;
  /** Injectable transport calls (defaults to the inbox server actions). */
  deps?: PollingDeps;
}

/**
 * Cursor-based polling transport. Never claims realtime; never fabricates
 * typing/presence. Dedupes on reconnect, backs off on failure, and slows down
 * when the tab is hidden. A Supabase Realtime adapter can implement the same
 * `ConversationTransport` interface later.
 */
export class PollingTransport implements ConversationTransport {
  private base: number;
  private hiddenMul: number;
  private maxBackoff: number;
  private fetchImpl: (conversationId: string, cursor?: string) => Promise<MessagePage>;
  private sendImpl: (conversationId: string, body: string) => Promise<SendMessageResult>;
  private markReadImpl: (conversationId: string, lastReadMessageId?: string) => Promise<void>;

  constructor(opts: PollingOptions = {}) {
    this.base = opts.baseIntervalMs ?? 4000;
    this.hiddenMul = opts.hiddenMultiplier ?? 4;
    this.maxBackoff = opts.maxBackoffMs ?? 60000;
    this.fetchImpl = opts.deps?.fetchSince ?? fetchSinceAction;
    this.sendImpl =
      opts.deps?.send ?? ((conversationId, body) => sendReplyFromTransport(conversationId, body));
    this.markReadImpl =
      opts.deps?.markRead ??
      ((conversationId, lastReadMessageId) =>
        markReadViaTransport(conversationId, lastReadMessageId));
  }

  subscribe(
    conversationId: string,
    handler: MessageHandler,
    opts: SubscribeOptions = {},
  ): Unsubscribe {
    const base = opts.baseIntervalMs ?? this.base;
    const pollOnce = opts.pollOnce ?? false;
    const seen = new Set<string>();
    let loop: PollLoopState = { cursor: opts.initialCursor, failures: 0 };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const schedule = (state: ConnectionState) => {
      if (stopped) return;
      const delay = nextPollDelay({
        base,
        hiddenMultiplier: this.hiddenMul,
        maxBackoff: this.maxBackoff,
        state: state === 'reconnecting' ? 'reconnecting' : 'open',
        failures: loop.failures,
        hidden: isHidden(),
        pollOnce,
      });
      if (delay === null) return; // closed conversation: stop after reconcile
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (stopped) return;
      let page: MessagePage | null = null;
      try {
        page = await this.fetchImpl(conversationId, loop.cursor);
      } catch {
        page = null;
      }
      // Reconciliation (dedup, ordering, cursor advance, backoff) is the pure,
      // tested domain function — the transport only owns timers + the `seen` set.
      const result = reconcileFetch(
        loop,
        seen,
        page
          ? { ok: true as const, messages: page.messages, nextCursor: page.nextCursor }
          : { ok: false as const },
      );
      loop = result.next;
      const state: ConnectionState = result.state === 'open' ? 'open' : 'reconnecting';
      handler(
        {
          messages: result.fresh,
          nextCursor: loop.cursor ?? null,
          hasMore: page?.hasMore ?? false,
        },
        state,
      );
      schedule(state);
    };

    // Re-poll promptly when the tab becomes visible again (safe resume).
    const onVisible = () => {
      if (!stopped && document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }

  fetchSince(conversationId: string, cursor?: string): Promise<MessagePage> {
    return this.fetchImpl(conversationId, cursor);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.sendImpl(input.conversationId, input.body);
  }

  async markRead(input: MarkReadInput): Promise<void> {
    await this.markReadImpl(input.conversationId, input.lastReadMessageId);
  }
}
