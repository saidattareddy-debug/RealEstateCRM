import Link from 'next/link';
import { LIVE_ACTIVATION_BLOCKER_LABELS, ACTIVATION_APPROVAL_ROLES } from '@re/domain';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel, StatCard } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { getActivationState, type ResponderChannel } from '@/lib/responder/activation';
import {
  RequestActivationForm,
  ApprovalControls,
  ApplyActivationForm,
  KillSwitchForm,
} from './activation-forms';

export const dynamic = 'force-dynamic';

const CHANNELS: ResponderChannel[] = ['website_chat', 'whatsapp', 'email', 'voice'];
const CHANNEL_LABEL: Record<ResponderChannel, string> = {
  website_chat: 'Website chat',
  whatsapp: 'WhatsApp',
  email: 'Email',
  voice: 'Voice',
};

export default async function ResponderActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'ai.settings.read')) return <PermissionDenied />;

  const sp = await searchParams;
  const channel = (CHANNELS as string[]).includes(sp.channel ?? '')
    ? (sp.channel as ResponderChannel)
    : 'website_chat';

  const supabase = await createSupabaseServerClient();
  const state = await getActivationState(supabase, ctx.activeTenantId!, channel, null);

  const canRequest = ensurePermission(ctx, 'responder.activation.request');
  const canApprove = ensurePermission(ctx, 'responder.activation.approve');
  const canManageChannel = ensurePermission(ctx, 'responder.channel.manage');
  const canKill = ensurePermission(ctx, 'responder.killswitch.manage');

  const req = state.pendingRequest;
  const completeness = state.decision.approvals;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Responder activation</h1>
        <p className="text-sm text-text-secondary">
          Governs the two-person workflow to stage automatic AI replies for a channel. Approving and
          applying here never starts real sending.
        </p>
      </header>

      {/* Master-switch banner — the headline safety fact. */}
      <div className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-4">
        <p className="text-sm font-semibold text-terracotta">
          Automatic customer sending is OFF (live-send master switch).
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Nothing on this page sends a message to a customer. The strongest mode that can be applied
          is <span className="font-medium">live candidate</span>, which is still suppressed by the
          per-message gate until the master switch is flipped in a separately reviewed release.
        </p>
      </div>

      {/* Channel selector */}
      <nav className="flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <Link
            key={c}
            href={`/settings/ai/activation?channel=${c}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              c === channel
                ? 'bg-forest text-white'
                : 'border border-border text-text-secondary hover:bg-surface-elevated'
            }`}
          >
            {CHANNEL_LABEL[c]}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Current mode" value={state.currentMode} />
        <StatCard label="Kill switch" value={state.killSwitchActive ? 'ACTIVE' : 'off'} />
        <StatCard
          label="Live sending"
          value={state.decision.liveSendingPermitted ? 'permitted' : 'blocked'}
        />
      </div>

      <Panel title="Decision">
        <p className="text-sm text-text-secondary">{state.decision.summary}</p>
        {state.decision.blockers.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
            {state.decision.blockers.map((b) => (
              <li key={b}>{LIVE_ACTIVATION_BLOCKER_LABELS[b]}</li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Pending request + approvals, or the request form. */}
      {req ? (
        <Panel title="Pending activation request">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-secondary">Requested mode</dt>
              <dd className="font-medium text-text-primary">{req.requestedMode}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Requested by</dt>
              <dd className="font-medium text-text-primary">{req.requestedBy}</dd>
            </div>
            {req.summary && (
              <div className="sm:col-span-2">
                <dt className="text-text-secondary">Summary</dt>
                <dd className="text-text-primary">{req.summary}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4">
            <p className="text-sm font-medium text-text-primary">Sign-off ledger</p>
            <ul className="mt-2 space-y-1 text-sm">
              {ACTIVATION_APPROVAL_ROLES.map((role) => {
                const approved = completeness.approvedRoles.includes(role);
                return (
                  <li key={role} className="flex items-center gap-2">
                    <span className={approved ? 'text-success' : 'text-text-secondary'}>
                      {approved ? '✓' : '○'}
                    </span>
                    <span className="capitalize">{role}</span>
                  </li>
                );
              })}
            </ul>
            {completeness.hasRejection && (
              <p className="mt-2 text-sm text-terracotta">A reviewer rejected this request.</p>
            )}
          </div>

          {canApprove && (
            <div className="mt-4 border-t border-border pt-4">
              <ApprovalControls requestId={req.id} />
            </div>
          )}
          {canManageChannel && (
            <div className="mt-4 border-t border-border pt-4">
              <ApplyActivationForm requestId={req.id} disabled={!completeness.complete} />
            </div>
          )}
        </Panel>
      ) : (
        canRequest && (
          <Panel title="Request activation">
            <RequestActivationForm channel={channel} />
          </Panel>
        )
      )}

      {/* Kill switch */}
      {canKill && (
        <Panel title="Kill switch">
          <p className="mb-3 text-sm text-text-secondary">
            Immediately stands down the responder for this channel. Independent of the master
            switch.
          </p>
          <KillSwitchForm channel={channel} active={state.killSwitchActive} />
        </Panel>
      )}
    </div>
  );
}
