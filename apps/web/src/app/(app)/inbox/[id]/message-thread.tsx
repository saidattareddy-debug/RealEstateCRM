'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PollingTransport } from '@/lib/transport/polling';
import type { ConnectionState, TransportMessage } from '@/lib/transport/types';

/**
 * Live conversation thread (Phase 4.1, Priority 1). The server renders the
 * initial page; this component mounts the {@link PollingTransport} after
 * hydration and applies incremental updates.
 *
 * Honesty rules: polling is never labelled "realtime"; there are no fabricated
 * typing or online indicators. Connection state is surfaced truthfully
 * (connected-through-polling / reconnecting / offline / session-expired).
 * Closed conversations poll once to reconcile, then stop.
 */
export function MessageThread({
  conversationId,
  initialMessages,
  initialCursor,
  closed,
}: {
  conversationId: string;
  initialMessages: TransportMessage[];
  initialCursor?: string;
  closed: boolean;
}) {
  const [messages, setMessages] = useState<TransportMessage[]>(initialMessages);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [pendingBelow, setPendingBelow] = useState(0);

  const seen = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const NEAR_BOTTOM_PX = 80;

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    setPendingBelow(0);
  }, []);

  // Land at the bottom on first paint (no animation).
  useEffect(() => {
    scrollToBottom('auto');
  }, [scrollToBottom]);

  // Track whether the user is reading older messages (scrolled up).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      nearBottomRef.current = isNearBottom();
      if (nearBottomRef.current) setPendingBelow(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    const transport = new PollingTransport();
    const unsubscribe = transport.subscribe(
      conversationId,
      (page, nextState) => {
        setState(nextState);
        if (page.messages.length === 0) return;
        const el = scrollRef.current;
        const wasNearBottom = el ? isNearBottom() : true;

        setMessages((prev) => {
          const fresh = page.messages.filter((m) => !seen.current.has(m.id));
          if (fresh.length === 0) return prev;
          for (const m of fresh) seen.current.add(m.id);
          const inboundFresh = fresh.filter((m) => m.direction !== 'internal').length;
          if (!wasNearBottom && inboundFresh > 0) {
            setPendingBelow((c) => c + inboundFresh);
          }
          return [...prev, ...fresh];
        });

        // Preserve scroll position when reading history; auto-scroll only when
        // the user was already at the bottom.
        if (wasNearBottom) requestAnimationFrame(() => scrollToBottom('smooth'));
      },
      {
        initialCursor,
        // Closed conversations reconcile once and then stop polling.
        pollOnce: closed,
        baseIntervalMs: closed ? 30000 : undefined,
      },
    );
    return unsubscribe;
  }, [conversationId, initialCursor, closed, isNearBottom, scrollToBottom]);

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between">
        <ConnectionBadge state={state} closed={closed} />
      </div>

      <div
        ref={scrollRef}
        className="max-h-[60vh] space-y-3 overflow-y-auto pr-1"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-text-secondary">No messages yet.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const outbound = m.direction === 'outbound';
              return (
                <li key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      outbound ? 'bg-forest text-white' : 'bg-surface-elevated text-text-primary'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.redacted ? '[redacted]' : m.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        outbound ? 'text-white/70' : 'text-text-secondary'
                      }`}
                    >
                      {m.sender} · {new Date(m.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {pendingBelow > 0 ? (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-forest px-3 py-1 text-xs font-medium text-white shadow"
        >
          {pendingBelow} new message{pendingBelow > 1 ? 's' : ''} ↓
        </button>
      ) : null}
    </div>
  );
}

function ConnectionBadge({ state, closed }: { state: ConnectionState; closed: boolean }) {
  if (closed) {
    return (
      <span className="text-[10px] text-text-secondary">Conversation closed — not polling</span>
    );
  }
  const map: Record<ConnectionState, { label: string; cls: string }> = {
    connecting: { label: 'Connecting…', cls: 'text-text-secondary' },
    open: { label: 'Connected (polling)', cls: 'text-success' },
    reconnecting: { label: 'Reconnecting…', cls: 'text-warning' },
    closed: { label: 'Offline', cls: 'text-text-secondary' },
    expired: { label: 'Session expired — reload', cls: 'text-terracotta' },
  };
  const { label, cls } = map[state];
  return (
    <span className={`flex items-center gap-1 text-[10px] ${cls}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
