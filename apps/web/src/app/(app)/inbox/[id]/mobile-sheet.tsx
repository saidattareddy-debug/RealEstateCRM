'use client';

import { useState, type ReactNode } from 'react';

/**
 * Mobile action sheet (Phase 4.1, Priority 5). On desktop the controls render
 * inline; on mobile they are reached through a sticky, safe-area-aware "Actions"
 * button that opens a slide-up sheet with large touch targets. Nothing sits under
 * the bottom navigation or the composer; the sheet is dismissable and keyboard
 * accessible (Escape + backdrop). No hover-only affordances.
 */
export function MobileSheet({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden md:block">{children}</div>

      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 rounded-full bg-forest px-5 py-3 text-sm font-semibold text-white shadow-lg"
        >
          {title}
        </button>

        {open ? (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <button
              type="button"
              aria-label="Close"
              className="flex-1"
              onClick={() => setOpen(false)}
            />
            <div className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary"
                >
                  Done
                </button>
              </div>
              <div className="space-y-4">{children}</div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
