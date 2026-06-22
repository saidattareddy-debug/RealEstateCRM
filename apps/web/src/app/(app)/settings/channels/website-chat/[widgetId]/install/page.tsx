import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { InstallControls } from './install-controls';

export const dynamic = 'force-dynamic';

export default async function WidgetInstallPage({
  params,
}: {
  params: Promise<{ widgetId: string }>;
}) {
  const { widgetId } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'website_chat.manage')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: widget } = await supabase
    .from('website_chat_widgets')
    .select('id, name, public_key, status, allowed_origins, rotated_at, created_at')
    .eq('id', widgetId)
    .maybeSingle();
  if (!widget) notFound();

  // Active-session count (never expose token hashes or session ids).
  const { count: activeSessions } = await supabase
    .from('website_chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('widget_id', widgetId)
    .eq('status', 'active');

  const snippet = `<script src="https://app.example.com/widget.js" data-widget-id="${widget.public_key}"></script>`;
  const origins = (widget.allowed_origins as string[]) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Install — {String(widget.name)}</h1>

      <Panel title="Embed snippet">
        <p className="mb-2 text-sm text-text-secondary">
          Paste this before <code>&lt;/body&gt;</code>. It exposes only the public widget id — never
          tenant or internal ids.
        </p>
        <pre className="overflow-x-auto rounded-md bg-surface-elevated p-3 text-xs text-text-primary">
          {snippet}
        </pre>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Status">
          <dl className="space-y-1 text-sm">
            <Row label="Widget status" value={String(widget.status)} />
            <Row label="Active sessions" value={String(activeSessions ?? 0)} />
            <Row
              label="Last credential rotation"
              value={
                widget.rotated_at ? new Date(widget.rotated_at as string).toLocaleString() : 'never'
              }
            />
          </dl>
          <div className="mt-3">
            <InstallControls widgetId={widgetId} status={String(widget.status)} />
          </div>
        </Panel>

        <Panel title="Allowed domains">
          {origins.length === 0 ? (
            <p className="text-sm text-terracotta">
              No domains configured — the widget will reject cross-site requests.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-text-primary">
              {origins.map((o) => (
                <li key={o} className="font-mono">
                  {o}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Installation checklist & CSP">
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          <li>Add your site domain(s) to the allowed-domains list.</li>
          <li>Verify your privacy-policy link is set (required for consent capture).</li>
          <li>
            CSP: allow the frame + script from the app origin —{' '}
            <code>script-src https://app.example.com</code>,{' '}
            <code>frame-src https://app.example.com</code>,{' '}
            <code>connect-src https://app.example.com</code>.
          </li>
          <li>
            Preview at <code>/chat/demo?widget={String(widget.public_key)}</code> (dev preview).
          </li>
        </ul>
      </Panel>

      <Panel title="Troubleshooting">
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          <li>403 from the widget → the page domain is not in the allowed list.</li>
          <li>Session expired → the visitor token aged out; “Clear chat” starts fresh.</li>
          <li>
            Nothing appears → check CSP <code>frame-src</code>/<code>script-src</code>.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="capitalize text-text-primary">{value}</dd>
    </div>
  );
}
