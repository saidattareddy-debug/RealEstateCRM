import { ChatWidget } from './widget-client';

export const dynamic = 'force-dynamic';

/**
 * Public widget runtime, loaded inside the isolated iframe created by
 * `/widget.js`. Only the public widget id reaches this route; everything else
 * (session, conversation, tenant) is resolved server-side from the opaque token.
 */
export default async function WidgetPage({ params }: { params: Promise<{ widgetId: string }> }) {
  const { widgetId } = await params;
  return (
    <main className="h-screen w-screen">
      <ChatWidget widgetId={widgetId} />
    </main>
  );
}
