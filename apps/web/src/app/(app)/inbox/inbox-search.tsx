'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { searchInbox, type SearchHit } from './search-actions';

export function InboxSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [pending, start] = useTransition();

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    start(async () => setHits(await searchInbox(q)));
  };

  return (
    <div className="space-y-2">
      <form onSubmit={run} className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations (lead, phone, email, message)…"
          aria-label="Search conversations"
          className="flex-1 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-primary"
        />
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>
      {hits !== null ? (
        hits.length === 0 ? (
          <p className="text-sm text-text-secondary">No matching conversations you can access.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border">
            {hits.map((h) => (
              <li key={h.conversationId}>
                <Link
                  href={`/inbox/${h.conversationId}`}
                  className="block px-3 py-2 text-sm hover:bg-surface-elevated"
                >
                  <span className="font-medium text-text-primary">
                    {h.leadName ?? 'Conversation'}
                  </span>{' '}
                  <span className="text-xs text-text-secondary">{h.channel.replace('_', ' ')}</span>
                  {h.snippet ? (
                    <span className="mt-0.5 block text-text-secondary">
                      {h.snippet.text.slice(0, h.snippet.matchStart)}
                      <mark className="bg-warning/30">
                        {h.snippet.text.slice(h.snippet.matchStart, h.snippet.matchEnd)}
                      </mark>
                      {h.snippet.text.slice(h.snippet.matchEnd)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
