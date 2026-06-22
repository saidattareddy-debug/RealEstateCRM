import type { NextRequest } from 'next/server';

/**
 * GET /widget.js — the embeddable loader (Phase 4.1, Priority 1).
 *
 * Reads ONLY the public `data-widget-id` from its own <script> tag and mounts an
 * isolated iframe pointing at `/chat/widget/[widgetId]`. It never receives or
 * exposes tenant, lead, or internal conversation ids; the widget config and the
 * opaque session-token flow are resolved server-side inside the iframe. Honours
 * reduced-motion and is keyboard accessible. Polling is never presented as
 * realtime; no fake typing/presence.
 */
export function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const js = `(function () {
  var s = document.currentScript;
  var widgetId = s && s.getAttribute('data-widget-id');
  if (!widgetId) { return; }
  if (document.getElementById('re-chat-frame')) { return; }
  var origin = ${JSON.stringify(origin)};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var btn = document.createElement('button');
  btn.id = 're-chat-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
  btn.textContent = 'Chat';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483000;border:0;border-radius:9999px;padding:12px 18px;background:#1f5c3d;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2);';

  // Unread badge — driven by the iframe's real unread count (postMessage). It
  // only grows while the panel is collapsed; opening clears it.
  var badge = document.createElement('span');
  badge.id = 're-chat-unread';
  badge.setAttribute('aria-live', 'polite');
  badge.style.cssText = 'position:fixed;bottom:42px;right:14px;z-index:2147483001;min-width:18px;height:18px;padding:0 5px;border-radius:9999px;background:#c0492f;color:#fff;font:600 11px system-ui,sans-serif;line-height:18px;text-align:center;display:none;box-shadow:0 2px 6px rgba(0,0,0,.25);';
  function setBadge(n) {
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = 'block'; btn.setAttribute('aria-label', 'Open chat, ' + n + ' unread'); }
    else { badge.style.display = 'none'; btn.setAttribute('aria-label', open ? 'Close chat' : 'Open chat'); }
  }

  var frame = document.createElement('iframe');
  frame.id = 're-chat-frame';
  frame.title = 'Chat';
  frame.setAttribute('aria-hidden', 'true');
  // Isolated runtime; only the public widget id is passed in the URL.
  frame.src = origin + '/chat/widget/' + encodeURIComponent(widgetId);
  frame.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483000;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;background:#fff;' + (reduce ? '' : 'transition:opacity .15s ease;');

  var open = false;
  function signalVisibility() {
    try { frame.contentWindow && frame.contentWindow.postMessage({ type: 're-chat-visibility', open: open }, origin); } catch (e) {}
  }
  function toggle() {
    open = !open;
    frame.style.display = open ? 'block' : 'none';
    frame.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) { setBadge(0); frame.focus(); }
    btn.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    signalVisibility();
  }
  btn.addEventListener('click', toggle);
  btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  // Receive the real unread count from the isolated iframe only (same origin).
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) { return; }
    var d = e.data;
    if (d && d.type === 're-chat-unread' && typeof d.count === 'number') {
      if (!open) { setBadge(d.count); }
    }
  });

  document.body.appendChild(btn);
  document.body.appendChild(badge);
  document.body.appendChild(frame);
})();`;

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
