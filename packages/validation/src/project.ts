import { z } from 'zod';

/** Shared schemas for projects & inventory (Phase 2). */

export const projectCategorySchema = z.enum(['apartment', 'villa', 'plot', 'commercial']);
export const projectSaleStatusSchema = z.enum(['upcoming', 'active', 'sold_out', 'on_hold']);
export const projectApprovalStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'archived',
]);
export const constructionStatusSchema = z.enum([
  'planning',
  'under_construction',
  'ready_to_move',
  'completed',
]);
export const inventoryStatusSchema = z.enum([
  'available',
  'temporarily_held',
  'reserved',
  'booked',
  'sold',
  'blocked',
  'unavailable',
]);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(160),
  developer: z.string().max(160).optional().nullable(),
  category: projectCategorySchema,
  saleStatus: projectSaleStatusSchema.default('active'),
  constructionStatus: constructionStatusSchema.optional().nullable(),
  locality: z.string().max(160).optional().nullable(),
  priceMin: z.coerce.number().nonnegative().optional().nullable(),
  priceMax: z.coerce.number().nonnegative().optional().nullable(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createUnitSchema = z.object({
  projectId: z.string().uuid(),
  unitNumber: z.string().min(1).max(40),
  status: inventoryStatusSchema.default('available'),
  price: z.coerce.number().nonnegative().optional().nullable(),
  carpetAreaSqft: z.coerce.number().positive().optional().nullable(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitStatusSchema = z.object({
  unitId: z.string().uuid(),
  status: inventoryStatusSchema,
});

export const importMappingSchema = z.object({
  unit_number: z.string().min(1),
  status: z.string().optional(),
  price: z.string().optional(),
  carpet_area_sqft: z.string().optional(),
  configuration_label: z.string().optional(),
});
export type ImportMappingInput = z.infer<typeof importMappingSchema>;
