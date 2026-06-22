import { PHASE_7A_ALLOWED_STATUSES, type IntegrationStatus } from '@re/domain';

/**
 * Shared, server-safe presentational helpers for the integration UI. A prominent
 * TEST-MODE banner is rendered on every integration surface so it is impossible
 * to mistake Phase 7A (mock / record-only) for a live integration.
 */

export function TestModeBanner({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <p className="font-semibold text-warning">{label}</p>
      <p className="mt-0.5 text-xs text-text-secondary">
        Phase 7A is mock / record-only. No external service is contacted and no message is ever
        sent. Connections can never reach a live “connected” state.
      </p>
    </div>
  );
}

const ALLOWED = new Set<string>(PHASE_7A_ALLOWED_STATUSES);

const STATUS_TONE: Record<string, string> = {
  draft: 'border-border bg-surface-elevated text-text-secondary',
  unconfigured: 'border-border bg-surface-elevated text-text-secondary',
  test: 'border-forest/40 bg-forest/10 text-forest',
  disabled: 'border-border bg-surface-elevated text-text-secondary',
};

/**
 * Render a connection status badge. Phase 7A only ever displays an allowed status
 * (draft/unconfigured/test/disabled); any other value is shown defensively as the
 * neutral “unconfigured” tone (a connected status is impossible by DB CHECK).
 */
export function StatusBadge({ status }: { status: string }) {
  const safe = ALLOWED.has(status) ? status : 'unconfigured';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
        STATUS_TONE[safe] ?? STATUS_TONE.unconfigured
      }`}
    >
      {safe}
    </span>
  );
}

const HEALTH_TONE: Record<string, string> = {
  healthy: 'border-success/40 bg-success/10 text-success',
  degraded: 'border-warning/40 bg-warning/10 text-warning',
  failing: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
  expired: 'border-warning/40 bg-warning/10 text-warning',
  revoked: 'border-terracotta/40 bg-terracotta/10 text-terracotta',
  disabled: 'border-border bg-surface-elevated text-text-secondary',
  unconfigured: 'border-border bg-surface-elevated text-text-secondary',
  unknown: 'border-border bg-surface-elevated text-text-secondary',
};

export function HealthBadge({ state }: { state: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
        HEALTH_TONE[state] ?? HEALTH_TONE.unknown
      }`}
    >
      {state}
    </span>
  );
}

/** True when a status is one Phase 7A may show (defensive UI guard). */
export function isAllowedStatus(status: string): status is IntegrationStatus {
  return ALLOWED.has(status);
}
