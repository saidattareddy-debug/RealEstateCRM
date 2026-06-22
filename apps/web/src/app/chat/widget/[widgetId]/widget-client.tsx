'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Msg {
  id: string;
  from: 'you' | 'agent';
  body: string;
  createdAt: string;
}
type State = 'intro' | 'loading' | 'open' | 'reconnecting' | 'expired' | 'error';

/**
 * Website chat widget runtime (Phase 4.1, Priority 1). Talks ONLY to the public
 * `/api/chat/[widgetId]/*` endpoints using the opaque session token; it never
 * sees tenant/lead/conversation ids. Polling (not realtime) — no fake
 * typing/presence. Honest intro/loading/reconnecting/expired/error states.
 */
export function ChatWidget({ widgetId }: { widgetId: string }) {
  const tokenKey = `re_chat_token_${widgetId}`;
  const [state, setState] = useState<State>('intro');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const cursorRef = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const tokenRef = useRef<string | null>(null);
  // Whether this panel is actually presented. The embed launcher posts
  // visibility changes; while collapsed we keep polling (delivery) but do NOT
  // acknowledge, so unread outbound messages accumulate honestly.
  const presentedRef = useRef(true);
  const lastOutboundRef = useRef<string | null>(null);

  const api = (path: string, body: unknown) =>
    fetch(`/api/chat/${encodeURIComponent(widgetId)}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const postUnread = (count: number) => {
    try {
      window.parent?.postMessage({ type: 're-chat-unread', count }, '*');
    } catch {
      /* no parent / cross-origin: ignore */
    }
  };

  const poll = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      // Acknowledge only the last outbound message actually presented (panel open).
      const ackMessageId =
        presentedRef.current && lastOutboundRef.current ? lastOutboundRef.current : undefined;
      const res = await api('messages', { token, cursor: cursorRef.current, ackMessageId });
      if (res.status === 401) {
        setState('expired');
        return;
      }
      if (!res.ok) {
        setState('reconnecting');
        return;
      }
      const data = (await res.json()) as {
        messages: Msg[];
        nextCursor: string | null;
        unread?: number;
      };
      const fresh = data.messages.filter((m) => !seen.current.has(m.id));
      for (const m of fresh) seen.current.add(m.id);
      if (data.nextCursor) cursorRef.current = data.nextCursor;
      if (fresh.length) setMessages((prev) => [...prev, ...fresh]);
      const lastOutbound = [...fresh].reverse().find((m) => m.from === 'agent');
      if (lastOutbound) lastOutboundRef.current = lastOutbound.id;
      // Collapsed → surface the real unread count to the launcher; open → 0.
      postUnread(presentedRef.current ? 0 : (data.unread ?? 0));
      setState('open');
    } catch {
      setState('reconnecting');
    }
  }, [widgetId]);

  // Launcher open/closed signal: ack only while presented; accumulate unread
  // while collapsed.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; open?: boolean } | null;
      if (d && d.type === 're-chat-visibility') {
        presentedRef.current = Boolean(d.open);
        if (d.open) void poll();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [poll]);

  // Resume a stored session on mount.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(tokenKey) : null;
    if (stored) {
      tokenRef.current = stored;
      setState('loading');
      void poll();
    }
  }, [poll, tokenKey]);

  // Poll loop — slower when the tab is hidden; pauses when expired/error.
  useEffect(() => {
    if (state === 'intro' || state === 'expired' || state === 'error') return;
    const id = setInterval(() => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!hidden) void poll();
    }, 4000);
    return () => clearInterval(id);
  }, [state, poll]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.trim() === '') return;
    setState('loading');
    try {
      const res = await api('start', { message: draft, consent: true, pageUrl: document.referrer });
      if (!res.ok) {
        setState('error');
        return;
      }
      const data = (await res.json()) as { token: string };
      tokenRef.current = data.token;
      window.localStorage.setItem(tokenKey, data.token);
      setMessages([{ id: 'local', from: 'you', body: draft, createdAt: new Date().toISOString() }]);
      seen.current.add('local');
      setDraft('');
      setState('open');
      void poll();
    } catch {
      setState('error');
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.trim() === '' || !tokenRef.current) return;
    const body = draft;
    setDraft('');
    const optimisticId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, from: 'you', body, createdAt: new Date().toISOString() },
    ]);
    seen.current.add(optimisticId);
    const res = await api('message', {
      token: tokenRef.current,
      body,
      clientMessageId: optimisticId,
    });
    if (res.status === 401) setState('expired');
  };

  const clear = async () => {
    if (tokenRef.current) await api('clear', { token: tokenRef.current });
    window.localStorage.removeItem(tokenKey);
    tokenRef.current = null;
    cursorRef.current = null;
    seen.current = new Set();
    setMessages([]);
    setState('intro');
  };

  return (
    <div className="flex h-full flex-col bg-white font-sans text-sm text-gray-800">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-semibold">Chat with us</span>
        {state !== 'intro' ? (
          <button type="button" onClick={clear} className="text-xs text-gray-500 underline">
            Clear chat
          </button>
        ) : null}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {state === 'expired' ? (
          <p className="rounded bg-amber-50 p-2 text-amber-700">
            Your session expired. Clear chat to start again.
          </p>
        ) : null}
        {state === 'error' ? (
          <p className="rounded bg-red-50 p-2 text-red-700">Something went wrong. Please retry.</p>
        ) : null}
        {state === 'reconnecting' ? <p className="text-xs text-gray-400">Reconnecting…</p> : null}
        {messages.map((m) => (
          <div key={m.id} className={m.from === 'you' ? 'text-right' : 'text-left'}>
            <span
              className={`inline-block rounded-lg px-3 py-1.5 ${
                m.from === 'you' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.body}
            </span>
          </div>
        ))}
        {state === 'loading' && messages.length === 0 ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : null}
      </div>

      <form onSubmit={state === 'intro' ? start : send} className="flex gap-2 border-t p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={state === 'intro' ? 'Type your message to begin…' : 'Type a message…'}
          aria-label="Message"
          className="flex-1 rounded border px-2 py-1.5"
          disabled={state === 'expired' || state === 'error'}
        />
        <button
          type="submit"
          disabled={state === 'expired' || state === 'error'}
          className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <p className="px-3 pb-2 text-[10px] text-gray-400">
        Replies are not live — we poll for updates.
      </p>
    </div>
  );
}
