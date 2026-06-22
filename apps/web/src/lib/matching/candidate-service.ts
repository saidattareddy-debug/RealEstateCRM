import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchCandidate, MatchModelVersion } from '@re/domain';

/**
 * Phase 6B — candidate generation (READ-ONLY).
 *
 * Builds the `MatchCandidate[]` the pure engine consumes from REAL project /
 * configuration / inventory rows, read through the caller's RLS-scoped client so
 * the user only ever sees projects they may see. Eligibility is filtered HERE
 * (tenant / active+approved / visible / sale-applicable / non-archived) AND
 * re-enforced by the domain (defence in depth).
 *
 * Inventory truth: for UNIT candidates we pass the unit's REAL `status` and its
 * `last_verified_at` timestamp truthfully — the domain decides whether the unit
 * is confirmed-available (status `available` AND within `freshnessWindowDays`).
 * Nothing here reserves, holds, or mutates inventory.
 */

export interface CandidateGenerationOptions {
  /** project | configuration | unit levels to generate (default: all three). */
  levels?: Array<'project' | 'configuration' | 'unit'>;
  /** Locality keys the lead has excluded (drives `excludedByLead`). */
  excludedLocalities?: string[];
  /** Hard cap on rows fetched per level to avoid runaway scans. */
  limitPerLevel?: number;
}

interface ProjectRow {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  sale_status: string;
  approval_status: string;
  locality: string | null;
  latitude: number | null;
  longitude: number | null;
  possession_date: string | null;
  price_min: number | null;
  price_max: number | null;
}

interface ConfigRow {
  id: string;
  tenant_id: string;
  project_id: string;
  label: string;
  base_price: number | null;
  carpet_area_sqft: number | null;
  saleable_area_sqft: number | null;
}

interface UnitRow {
  id: string;
  tenant_id: string;
  project_id: string;
  configuration_id: string | null;
  status: string;
  price: number | null;
  last_verified_at: string;
}

interface AmenityRow {
  project_id: string;
  name: string;
}

const PROJECT_COLS =
  'id, tenant_id, name, category, sale_status, approval_status, locality, latitude, longitude, possession_date, price_min, price_max';

/** A project is "active" for matching when its sale lifecycle can transact. */
function projectActive(sale_status: string): boolean {
  return sale_status === 'active' || sale_status === 'upcoming';
}

/** Build the shared candidate fields a project/config/unit exposes to rules. */
function projectFields(
  p: ProjectRow,
  amenities: string[],
  hasAvailable: boolean | undefined,
  hasFreshAvailable: boolean | undefined,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    locality: p.locality ?? undefined,
    category: p.category,
    propertyType: p.category,
    price: p.price_min ?? undefined,
    possessionDate: p.possession_date ?? undefined,
    amenities,
  };
  if (hasAvailable !== undefined) fields.hasAvailableUnit = hasAvailable;
  if (hasFreshAvailable !== undefined) fields.hasFreshAvailableUnit = hasFreshAvailable;
  return fields;
}

/**
 * Generate candidates for a lead. The `client` MUST be the user's RLS-scoped
 * server client so project/lead visibility is enforced by the database.
 */
export async function generateCandidates(
  client: SupabaseClient,
  tenantId: string,
  model: MatchModelVersion,
  options: CandidateGenerationOptions = {},
): Promise<MatchCandidate[]> {
  const levels = options.levels ?? ['project', 'configuration', 'unit'];
  const limit = options.limitPerLevel ?? 200;
  const excluded = new Set((options.excludedLocalities ?? []).map((l) => l.toLowerCase()));
  const nowMs = Date.now();
  const freshnessMs = model.freshnessWindowDays * 86_400_000;

  // Only sale-applicable, approved projects are eligible. RLS already scopes the
  // result to projects this user may see; we additionally filter approval here.
  const { data: projectRows } = await client
    .from('projects')
    .select(PROJECT_COLS)
    .eq('tenant_id', tenantId)
    .eq('approval_status', 'approved')
    .limit(limit);
  const projects = (projectRows ?? []) as ProjectRow[];
  if (projects.length === 0) return [];
  const projectIds = projects.map((p) => p.id);

  // Amenities per project (reference facts for amenity rules).
  const { data: amenityRows } = await client
    .from('project_amenities')
    .select('project_id, name')
    .in('project_id', projectIds);
  const amenitiesByProject = new Map<string, string[]>();
  for (const a of (amenityRows ?? []) as AmenityRow[]) {
    const arr = amenitiesByProject.get(a.project_id) ?? [];
    arr.push(a.name);
    amenitiesByProject.set(a.project_id, arr);
  }

  // Units for availability rollups + unit-level candidates (sale inventory only:
  // not sold / booked / blocked — those cannot be offered).
  const { data: unitRows } = await client
    .from('inventory_units')
    .select('id, tenant_id, project_id, configuration_id, status, price, last_verified_at')
    .in('project_id', projectIds)
    .limit(limit * 4);
  const units = (unitRows ?? []) as UnitRow[];

  // Availability rollups keyed by project / configuration.
  const projHasAvailable = new Map<string, boolean>();
  const projHasFresh = new Map<string, boolean>();
  const cfgHasAvailable = new Map<string, boolean>();
  const cfgHasFresh = new Map<string, boolean>();
  for (const u of units) {
    if (u.status !== 'available') continue;
    const fresh = nowMs - new Date(u.last_verified_at).getTime() <= freshnessMs;
    projHasAvailable.set(u.project_id, true);
    if (fresh) projHasFresh.set(u.project_id, true);
    if (u.configuration_id) {
      cfgHasAvailable.set(u.configuration_id, true);
      if (fresh) cfgHasFresh.set(u.configuration_id, true);
    }
  }

  const candidates: MatchCandidate[] = [];

  for (const p of projects) {
    const amenities = amenitiesByProject.get(p.id) ?? [];
    const active = projectActive(p.sale_status);
    const approved = p.approval_status === 'approved';
    const excludedByLead = p.locality ? excluded.has(p.locality.toLowerCase()) : false;
    // RLS already returned only visible projects; the row's presence == visible.
    const base = {
      tenantId: p.tenant_id,
      projectId: p.id,
      inTenant: p.tenant_id === tenantId,
      projectActive: active,
      projectApproved: approved,
      projectVisible: true,
      saleApplicable: true,
      propertyCategoryAllowed: true,
      excludedByLead,
    };

    if (levels.includes('project')) {
      candidates.push({
        id: `project:${p.id}`,
        level: 'project',
        ...base,
        fields: projectFields(p, amenities, projHasAvailable.get(p.id), projHasFresh.get(p.id)),
        advertisedMin: p.price_min ?? undefined,
        advertisedMax: p.price_max ?? undefined,
      });
    }
  }

  if (levels.includes('configuration')) {
    const { data: configRows } = await client
      .from('project_configurations')
      .select('id, tenant_id, project_id, label, base_price, carpet_area_sqft, saleable_area_sqft')
      .in('project_id', projectIds)
      .limit(limit * 2);
    const projById = new Map(projects.map((p) => [p.id, p]));
    for (const c of (configRows ?? []) as ConfigRow[]) {
      const p = projById.get(c.project_id);
      if (!p) continue;
      const amenities = amenitiesByProject.get(p.id) ?? [];
      const excludedByLead = p.locality ? excluded.has(p.locality.toLowerCase()) : false;
      const fields = projectFields(p, amenities, cfgHasAvailable.get(c.id), cfgHasFresh.get(c.id));
      fields.configuration = c.label;
      if (c.carpet_area_sqft != null) fields.carpetArea = c.carpet_area_sqft;
      candidates.push({
        id: `configuration:${c.id}`,
        level: 'configuration',
        tenantId: c.tenant_id,
        projectId: c.project_id,
        projectConfigurationId: c.id,
        inTenant: c.tenant_id === tenantId,
        projectActive: projectActive(p.sale_status),
        projectApproved: p.approval_status === 'approved',
        projectVisible: true,
        saleApplicable: true,
        propertyCategoryAllowed: true,
        excludedByLead,
        fields,
        configBaseMin: c.base_price ?? undefined,
        configBaseMax: c.base_price ?? undefined,
      });
    }
  }

  if (levels.includes('unit')) {
    const projById = new Map(projects.map((p) => [p.id, p]));
    // Sale inventory: surface available + recently-changed units only; never
    // sold/booked. Non-available statuses still flow to the domain as truthful
    // `unitStatus` so the engine can flag them (it never marks them confirmed).
    const offerable = units.filter(
      (u) => u.status !== 'sold' && u.status !== 'booked' && u.status !== 'blocked',
    );
    for (const u of offerable.slice(0, limit)) {
      const p = projById.get(u.project_id);
      if (!p) continue;
      const amenities = amenitiesByProject.get(p.id) ?? [];
      const excludedByLead = p.locality ? excluded.has(p.locality.toLowerCase()) : false;
      const fields = projectFields(p, amenities, undefined, undefined);
      candidates.push({
        id: `unit:${u.id}`,
        level: 'unit',
        tenantId: u.tenant_id,
        projectId: u.project_id,
        projectConfigurationId: u.configuration_id ?? undefined,
        inventoryUnitId: u.id,
        inTenant: u.tenant_id === tenantId,
        projectActive: projectActive(p.sale_status),
        projectApproved: p.approval_status === 'approved',
        projectVisible: true,
        saleApplicable: true,
        propertyCategoryAllowed: true,
        excludedByLead,
        fields,
        unitPrice: u.price ?? undefined,
        unitStatus: u.status,
        unitVerifiedAt: u.last_verified_at,
      });
    }
  }

  return candidates;
}
