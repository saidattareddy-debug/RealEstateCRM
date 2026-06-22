import { DATASET_ID } from './safety.mjs';

/** Minimal, dependency-free CLI arg parser for the demo scripts. */
export function parseArgs(argv) {
  const opts = {
    tenant: 'northwind-estates',
    adminEmail: null,
    datasetVersion: DATASET_ID,
    confirm: false,
    dryRun: false,
    createTenant: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') opts.confirm = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--create-tenant') opts.createTenant = true;
    else if (a === '--tenant') opts.tenant = argv[++i];
    else if (a === '--admin-email') opts.adminEmail = argv[++i];
    else if (a === '--dataset-version') opts.datasetVersion = argv[++i];
  }
  return opts;
}

/** Build a demo audit-event writer that inserts directly via the admin client. */
export function makeAuditWriter(admin, { tenantId, datasetVersion, correlationId, actorUserId }) {
  return async (action, metadata = {}) => {
    try {
      await admin
        .from('audit_logs')
        .insert({
          tenant_id: tenantId,
          actor_user_id: actorUserId ?? null,
          action,
          entity_type: 'demo_seed',
          metadata: {
            tenant: tenantId,
            dataset_version: datasetVersion,
            correlation_id: correlationId,
            ...metadata, // section + counts only — never secrets/payloads/bodies
          },
          correlation_id: correlationId,
        })
        .select('id')
        .maybeSingle();
    } catch {
      // Audit must never break the seed's critical path.
    }
  };
}
