'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordMockInbound, recordMockDelivery, simulateHumanWhatsApp } from './actions';

const input =
  'rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary';
const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50';
const btnPrimary =
  'rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50';

export function WhatsAppTestPanel({
  connectionId,
  canSimulate,
  conversations,
}: {
  connectionId: string;
  canSimulate: boolean;
  conversations: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [inboundText, setInboundText] = useState('Hi, is the 2BHK still available?');
  const [deliveryKind, setDeliveryKind] = useState('message_delivered');
  const [conversationId, setConversationId] = useState(conversations[0]?.id ?? '');
  const [sendBody, setSendBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      setMsg(null);
      const res = await fn();
      setMsg(res.error ? res.error : 'Recorded.');
      if (!res.error) router.refresh();
    });

  function simulate() {
    setMsg(null);
    setPreview(null);
    setBlocked(false);
    start(async () => {
      const res = await simulateHumanWhatsApp({ conversationId, body: sendBody });
      if (res.error) {
        setMsg(res.error);
        return;
      }
      setBlocked(Boolean(res.blocked));
      setMsg(res.reason ?? null);
      setPreview(res.preview ?? null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">Mock inbound message</p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            value={inboundText}
            onChange={(e) => setInboundText(e.target.value)}
            disabled={pending}
            className={`w-80 ${input}`}
          />
          <button
            type="button"
            onClick={() => run(() => recordMockInbound({ connectionId, text: inboundText }))}
            disabled={pending || inboundText.trim() === ''}
            className={btnPrimary}
          >
            Record mock inbound
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">Mock delivery callback</p>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={deliveryKind}
            onChange={(e) => setDeliveryKind(e.target.value)}
            disabled={pending}
            className={input}
          >
            <option value="message_sent">message_sent</option>
            <option value="message_delivered">message_delivered</option>
            <option value="message_read">message_read</option>
            <option value="message_failed">message_failed</option>
          </select>
          <button
            type="button"
            onClick={() => run(() => recordMockDelivery({ connectionId, kind: deliveryKind }))}
            disabled={pending}
            className={btn}
          >
            Record mock delivery
          </button>
        </div>
      </div>

      {canSimulate ? (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-warning">SIMULATION — MESSAGE NOT SENT</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-text-secondary">
              Conversation
              <select
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
                disabled={pending}
                className={`mt-1 ${input}`}
              >
                {conversations.length === 0 ? <option value="">No conversations</option> : null}
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            value={sendBody}
            onChange={(e) => setSendBody(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Message the agent would send"
            className={`w-full ${input}`}
          />
          <button
            type="button"
            onClick={simulate}
            disabled={pending || conversationId === '' || sendBody.trim() === ''}
            className={btnPrimary}
          >
            Run send simulation
          </button>
          {preview ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-warning">SIMULATION — MESSAGE NOT SENT</p>
              <p className="mt-1 text-text-primary">{preview}</p>
            </div>
          ) : null}
          {blocked ? <p className="text-sm text-terracotta">Blocked: {msg}</p> : null}
        </div>
      ) : null}

      {msg && !blocked && !preview ? <p className="text-sm text-text-secondary">{msg}</p> : null}
    </div>
  );
}
