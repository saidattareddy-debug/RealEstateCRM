import { z } from 'zod';

/** Shared tenant/identity schemas validated at API and form boundaries. */

export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug');

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour');

export const tenantStatusSchema = z.enum(['active', 'suspended']);
export const deploymentModeSchema = z.enum(['shared', 'dedicated']);

export const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
  planTier: z.enum(['starter', 'growth', 'enterprise']).default('starter'),
  deploymentMode: deploymentModeSchema.default('shared'),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantBrandingSchema = z.object({
  primaryColor: hexColorSchema.default('#274D3D'),
  secondaryColor: hexColorSchema.default('#18372B'),
  accentColor: hexColorSchema.default('#B79257'),
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  customDomain: z.string().min(3).nullable().optional(),
});
export type TenantBrandingInput = z.infer<typeof tenantBrandingSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  roleSlug: z.string().min(2),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** E.164 phone format used everywhere (docs/DATABASE.md §1). */
export const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'must be E.164 format, e.g. +919812345678');
