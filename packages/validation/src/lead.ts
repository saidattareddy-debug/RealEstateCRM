import { z } from 'zod';

/** Lead ingestion + management schemas (Phase 3). */

export const leadInputSchema = z.object({
  fullName: z.string().min(1).max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  preferredLanguage: z.string().max(20).optional().nullable(),
  campaign: z.string().max(160).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  sourceLeadId: z.string().max(160).optional().nullable(),
  utm: z.record(z.string()).optional(),
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const createNoteSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

export const moveStageSchema = z.object({
  leadId: z.string().uuid(),
  stageId: z.string().uuid(),
  reason: z.string().max(300).optional().nullable(),
});

export const assignLeadSchema = z.object({
  leadId: z.string().uuid(),
  agentId: z.string().uuid(),
});

export const resolveDuplicateSchema = z.object({
  duplicateId: z.string().uuid(),
  action: z.enum(['merge', 'dismiss']),
});

/** Manual call logging (no telephony integration — record-keeping only). */
export const callDirections = ['inbound', 'outbound'] as const;
// Must match the public.call_status enum in supabase/migrations/0010.
export const callStatuses = [
  'connected',
  'no_answer',
  'busy',
  'wrong_number',
  'switched_off',
  'callback_requested',
  'cancelled',
] as const;

export const logCallSchema = z.object({
  leadId: z.string().uuid(),
  direction: z.enum(callDirections),
  status: z.enum(callStatuses),
  outcome: z.string().max(300).optional().nullable(),
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  callbackAt: z.string().datetime().optional().nullable(),
});
export type LogCallInput = z.infer<typeof logCallSchema>;

export const savedViewScopes = ['private', 'team', 'tenant'] as const;
export const saveViewSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(120),
  scope: z.enum(savedViewScopes).default('private'),
  config: z.record(z.unknown()).default({}),
  isDefault: z.boolean().default(false),
});
export type SaveViewInput = z.infer<typeof saveViewSchema>;
