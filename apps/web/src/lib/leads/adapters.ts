import type { LeadInput } from '@re/validation';
import type { SourceKind } from './ingest';

/**
 * SYNTHETIC development adapters that map provider-shaped payloads to the
 * canonical LeadInput. These are NOT connected to any live provider — live
 * provider webhooks (signature, field mapping, OAuth) are wired in Phase 7.
 * Each adapter returns the normalized input plus the provider's external id
 * (used for cross-tenant-safe idempotency).
 */

export interface AdapterResult {
  input: LeadInput;
  externalEventId: string | null;
  sourceKind: SourceKind;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function adaptGeneric(b: Raw): AdapterResult {
  return {
    input: {
      fullName: s(b.name) ?? s(b.full_name),
      phone: s(b.phone) ?? s(b.mobile),
      email: s(b.email),
      campaign: s(b.campaign),
      source: s(b.source) ?? 'website',
      sourceLeadId: s(b.id) ?? s(b.lead_id),
      utm: (b.utm as Record<string, string>) ?? {},
    },
    externalEventId: s(b.id) ?? s(b.lead_id),
    sourceKind: 'form',
  };
}

export function adaptNoBroker(b: Raw): AdapterResult {
  return {
    input: {
      fullName: s(b.customerName),
      phone: s(b.contactNumber),
      email: s(b.emailId),
      campaign: s(b.projectName),
      source: 'NoBroker',
      sourceLeadId: s(b.enquiryId),
    },
    externalEventId: s(b.enquiryId),
    sourceKind: 'portal',
  };
}

export function adapt99acres(b: Raw): AdapterResult {
  return {
    input: {
      fullName: s(b.userName),
      phone: s(b.userMobile),
      email: s(b.userEmail),
      campaign: s(b.projName),
      source: '99acres',
      sourceLeadId: s(b.responseId),
    },
    externalEventId: s(b.responseId),
    sourceKind: 'portal',
  };
}

export function adaptHousing(b: Raw): AdapterResult {
  return {
    input: {
      fullName: s(b.lead_name),
      phone: s(b.lead_phone),
      email: s(b.lead_email),
      campaign: s(b.listing_title),
      source: 'Housing.com',
      sourceLeadId: s(b.lead_id),
    },
    externalEventId: s(b.lead_id),
    sourceKind: 'portal',
  };
}

export function adaptMeta(b: Raw): AdapterResult {
  // Simplified Meta lead-form shape.
  const fields = (b.field_data as { name: string; values: string[] }[]) ?? [];
  const get = (n: string) => fields.find((f) => f.name === n)?.values?.[0] ?? null;
  return {
    input: {
      fullName: get('full_name'),
      phone: get('phone_number'),
      email: get('email'),
      campaign: s(b.campaign_name),
      source: 'Meta',
      sourceLeadId: s(b.leadgen_id),
    },
    externalEventId: s(b.leadgen_id),
    sourceKind: 'ad',
  };
}

export function adaptGoogle(b: Raw): AdapterResult {
  const cols = (b.user_column_data as { column_id: string; string_value: string }[]) ?? [];
  const get = (n: string) => cols.find((c) => c.column_id === n)?.string_value ?? null;
  return {
    input: {
      fullName: get('FULL_NAME'),
      phone: get('PHONE_NUMBER'),
      email: get('EMAIL'),
      campaign: s(b.campaign_id),
      source: 'Google',
      sourceLeadId: s(b.lead_id),
    },
    externalEventId: s(b.lead_id),
    sourceKind: 'ad',
  };
}

export const ADAPTERS: Record<string, (b: Raw) => AdapterResult> = {
  generic: adaptGeneric,
  nobroker: adaptNoBroker,
  '99acres': adapt99acres,
  housing: adaptHousing,
  meta: adaptMeta,
  google: adaptGoogle,
};
