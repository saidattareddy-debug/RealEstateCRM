import Link from 'next/link';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import { BrandingForm, OrgForm } from './settings-forms';

export default async function SettingsPage() {
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'settings.org.manage')) {
    return <PermissionDenied />;
  }

  const supabase = await createSupabaseServerClient();
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('timezone, currency, audit_retention_days')
    .eq('tenant_id', ctx.activeTenantId!)
    .maybeSingle();

  const b = ctx.branding;
  const canBrand = ensurePermission(ctx, 'settings.branding.manage');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Settings</h1>

      <Panel title="Branding">
        {canBrand ? (
          <BrandingForm
            primary={b?.primaryColor ?? '#274D3D'}
            secondary={b?.secondaryColor ?? '#18372B'}
            accent={b?.accentColor ?? '#B79257'}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            You can view but not change branding (requires branding-manage permission).
          </p>
        )}
        <p className="mt-3 text-xs text-text-secondary">
          White-label mode: {b?.whiteLabel ? 'on' : 'off'}. Colours apply across the workspace at
          runtime.
        </p>
      </Panel>

      <Panel title="Organisation">
        <OrgForm
          timezone={settings?.timezone ?? 'Asia/Kolkata'}
          currency={settings?.currency ?? 'INR'}
          retention={(settings?.audit_retention_days as number) ?? 365}
        />
      </Panel>

      {ensurePermission(ctx, 'ai.settings.read') ? (
        <Panel title="AI & Knowledge">
          <p className="mb-2 text-sm text-text-secondary">
            Configure AI providers, models, prompts, policies and usage limits. Customer-facing AI
            answering stays disabled until a later phase.
          </p>
          <Link href="/settings/ai" className="text-sm text-forest hover:underline">
            Open AI settings →
          </Link>
        </Panel>
      ) : null}
    </div>
  );
}
