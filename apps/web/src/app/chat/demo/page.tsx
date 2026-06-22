export const dynamic = 'force-dynamic';

/**
 * /chat/demo — a clearly-labelled LOCAL DEVELOPMENT preview of the website chat
 * widget. It is not a production embed; a real widget public key and an active
 * widget are required before the runtime connects.
 */
export default async function ChatDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ widget?: string }>;
}) {
  const { widget } = await searchParams;
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <strong>Local development preview.</strong> This page is not the production widget. Connect
        a live backend and an active widget before relying on it.
      </div>
      <h1 className="text-xl font-semibold">Website chat widget — demo</h1>
      <p className="text-sm text-gray-600">
        Provide a widget public key via <code>?widget=public_key</code> to load the runtime in an
        isolated frame below. The frame talks only to the public <code>/api/chat/[widgetId]/*</code>{' '}
        endpoints using an opaque session token.
      </p>
      {widget ? (
        <iframe
          title="Chat widget demo"
          src={`/chat/widget/${encodeURIComponent(widget)}`}
          className="h-[520px] w-[360px] rounded-lg border shadow"
        />
      ) : (
        <p className="text-sm text-gray-500">No widget key supplied.</p>
      )}
      <p className="text-xs text-gray-500">
        Production sites embed the widget with:&nbsp;
        <code>{'<script src="/widget.js" data-widget-id="public_widget_id"></script>'}</code>
      </p>
    </main>
  );
}
