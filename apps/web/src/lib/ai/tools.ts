import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Dynamic-tool ALLOW-LIST (Phase 5A §13).
 *
 * SAFETY INVARIANTS:
 *  - This is a fixed allow-list. `callTool` rejects any name not in
 *    `TOOL_REGISTRY`. There is NO path that accepts an arbitrary table name or
 *    SQL — every tool issues a specific, parameterised Supabase query.
 *  - All tools are READ-ONLY. Nothing here mutates state.
 *  - Tenant + project are resolved SERVER-SIDE under the caller's RLS session
 *    client. We never trust a client-supplied tenant_id. A project that is not
 *    owned by the caller's tenant simply returns no rows (RLS) and is reported
 *    as not approved / not found.
 *  - Internal DB ids/columns are NOT exposed to customers: results are shaped
 *    into customer-safe structured data and size-limited.
 *  - Availability answers use REAL inventory. When the underlying data is stale,
 *    unverified, or the project is not approved, the tool sets `stale: true`
 *    and/or `approved: false` so the orchestrator escalates rather than asserts.
 */

/** Inventory older than this is considered stale (caller escalates). */
const INVENTORY_FRESHNESS_HOURS = 24;
/** Hard cap on rows returned by any single tool (prevents oversized prompts). */
const MAX_ROWS = 25;

export interface ToolContext {
  tenantId: string;
  projectId: string;
}

export interface ToolResult {
  tool: string;
  /** Customer-safe structured data (never raw DB ids/columns). */
  data: unknown;
  /** Most recent freshness timestamp relevant to the data, if any. */
  freshnessAt: string | null;
  /** True when the data is stale and must not be asserted as current. */
  stale: boolean;
  /** True when the project is approved/published (answers may rely on it). */
  approved: boolean;
  /** Safe, short summary for the run trace (no PII / no internal ids). */
  summary: string;
}

type ToolHandler = (supabase: SupabaseClient, ctx: ToolContext) => Promise<ToolResult>;

function olderThanHours(iso: string | null, hours: number, now: number): boolean {
  if (!iso) return true;
  return now - new Date(iso).getTime() > hours * 3_600_000;
}

/** Resolve the project (RLS-scoped) and whether it is approved/published. */
async function loadProject(
  supabase: SupabaseClient,
  ctx: ToolContext,
): Promise<{
  found: boolean;
  approved: boolean;
  row: Record<string, unknown> | null;
}> {
  const { data } = await supabase
    .from('projects')
    .select(
      'id, name, developer, category, locality, address, possession_date, price_min, price_max, currency, approval_status, sale_status, construction_status, description',
    )
    .eq('id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (!data) return { found: false, approved: false, row: null };
  const approved = String((data as Record<string, unknown>).approval_status) === 'approved';
  return { found: true, approved, row: data as Record<string, unknown> };
}

const getProjectOverview: ToolHandler = async (supabase, ctx) => {
  const { found, approved, row } = await loadProject(supabase, ctx);
  if (!found || !row) {
    return {
      tool: 'getProjectOverview',
      data: null,
      freshnessAt: null,
      stale: true,
      approved: false,
      summary: 'project_not_found',
    };
  }
  return {
    tool: 'getProjectOverview',
    data: {
      name: row.name,
      developer: row.developer ?? null,
      category: row.category ?? null,
      locality: row.locality ?? null,
      possessionDate: row.possession_date ?? null,
      constructionStatus: row.construction_status ?? null,
      saleStatus: row.sale_status ?? null,
      description: row.description ?? null,
    },
    freshnessAt: null,
    stale: false,
    approved,
    summary: `overview:${approved ? 'approved' : 'unapproved'}`,
  };
};

const getProjectConfigurations: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const { data } = await supabase
    .from('project_configurations')
    .select('label, carpet_area_sqft, builtup_area_sqft, saleable_area_sqft, base_price')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .limit(MAX_ROWS);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    tool: 'getProjectConfigurations',
    data: rows.map((r) => ({
      label: r.label,
      carpetAreaSqft: r.carpet_area_sqft ?? null,
      builtupAreaSqft: r.builtup_area_sqft ?? null,
      saleableAreaSqft: r.saleable_area_sqft ?? null,
      basePrice: r.base_price ?? null,
    })),
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `configurations:${rows.length}`,
  };
};

const getCurrentInventorySummary: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const { data } = await supabase
    .from('inventory_units')
    .select('status, last_verified_at, updated_at')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .limit(5000);
  const rows = (data ?? []) as Record<string, unknown>[];
  const now = Date.now();
  let available = 0;
  let total = 0;
  let stale = false;
  let freshnessAt: string | null = null;
  for (const r of rows) {
    total += 1;
    if (String(r.status) === 'available') available += 1;
    const verified = (r.last_verified_at as string | null) ?? (r.updated_at as string | null);
    if (!freshnessAt || (verified && verified < freshnessAt)) freshnessAt = verified;
    if (olderThanHours(verified, INVENTORY_FRESHNESS_HOURS, now)) stale = true;
  }
  return {
    tool: 'getCurrentInventorySummary',
    data: { availableUnits: available, totalUnits: total },
    freshnessAt,
    // Availability is unverified if data is stale, project not approved, or empty.
    stale: stale || !found || total === 0,
    approved,
    summary: `inventory:${available}/${total}`,
  };
};

const getAvailableUnits: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const { data } = await supabase
    .from('inventory_units')
    .select('unit_number, status, price, carpet_area_sqft, last_verified_at, updated_at')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'available')
    .order('unit_number', { ascending: true })
    .limit(MAX_ROWS);
  const rows = (data ?? []) as Record<string, unknown>[];
  const now = Date.now();
  let stale = !found || rows.length === 0;
  let freshnessAt: string | null = null;
  for (const r of rows) {
    const verified = (r.last_verified_at as string | null) ?? (r.updated_at as string | null);
    if (!freshnessAt || (verified && verified < freshnessAt)) freshnessAt = verified;
    if (olderThanHours(verified, INVENTORY_FRESHNESS_HOURS, now)) stale = true;
  }
  return {
    tool: 'getAvailableUnits',
    data: rows.map((r) => ({
      unitNumber: r.unit_number,
      price: r.price ?? null,
      carpetAreaSqft: r.carpet_area_sqft ?? null,
    })),
    freshnessAt,
    stale,
    approved,
    summary: `available_units:${rows.length}`,
  };
};

const getCurrentPriceRange: ToolHandler = async (supabase, ctx) => {
  const { found, approved, row } = await loadProject(supabase, ctx);
  // Prefer live inventory price spread; fall back to project price_min/max.
  const { data } = await supabase
    .from('inventory_units')
    .select('price, last_verified_at, updated_at')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'available')
    .not('price', 'is', null)
    .limit(5000);
  const rows = (data ?? []) as Record<string, unknown>[];
  const now = Date.now();
  let min: number | null = null;
  let max: number | null = null;
  let stale = !found;
  let freshnessAt: string | null = null;
  for (const r of rows) {
    const p = r.price == null ? null : Number(r.price);
    if (p != null && !Number.isNaN(p)) {
      min = min == null ? p : Math.min(min, p);
      max = max == null ? p : Math.max(max, p);
    }
    const verified = (r.last_verified_at as string | null) ?? (r.updated_at as string | null);
    if (!freshnessAt || (verified && verified < freshnessAt)) freshnessAt = verified;
    if (olderThanHours(verified, INVENTORY_FRESHNESS_HOURS, now)) stale = true;
  }
  const fromProject = min == null && max == null && row != null;
  if (fromProject && row) {
    min = row.price_min == null ? null : Number(row.price_min);
    max = row.price_max == null ? null : Number(row.price_max);
  }
  return {
    tool: 'getCurrentPriceRange',
    data: {
      min,
      max,
      currency: (row?.currency as string | null) ?? 'INR',
      source: fromProject ? 'project_published_range' : 'live_inventory',
    },
    freshnessAt,
    // A project published range is not "current inventory" — treat as stale for
    // hard availability claims so the agent verifies.
    stale: stale || fromProject || rows.length === 0,
    approved,
    summary: `price_range:${min ?? '-'}-${max ?? '-'}`,
  };
};

const getCurrentOffers: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('project_offers')
    .select('title, details, valid_until, is_active')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)
    .limit(MAX_ROWS);
  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (r) => !r.valid_until || String(r.valid_until) >= today,
  );
  return {
    tool: 'getCurrentOffers',
    data: rows.map((r) => ({
      title: r.title,
      details: r.details ?? null,
      validUntil: r.valid_until ?? null,
    })),
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `offers:${rows.length}`,
  };
};

const getProjectAmenities: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const { data } = await supabase
    .from('project_amenities')
    .select('name')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .limit(MAX_ROWS);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    tool: 'getProjectAmenities',
    data: rows.map((r) => r.name),
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `amenities:${rows.length}`,
  };
};

const getProjectLocationFacts: ToolHandler = async (supabase, ctx) => {
  const { found, approved, row } = await loadProject(supabase, ctx);
  return {
    tool: 'getProjectLocationFacts',
    data: row
      ? {
          locality: row.locality ?? null,
          address: row.address ?? null,
        }
      : null,
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `location:${found ? 'ok' : 'missing'}`,
  };
};

const getProjectDocuments: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  // Customer-safe document references only: type + title. Never the storage URL.
  const { data } = await supabase
    .from('project_documents')
    .select('doc_type, title')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .limit(MAX_ROWS);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    tool: 'getProjectDocuments',
    data: rows.map((r) => ({ docType: r.doc_type, title: r.title })),
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `documents:${rows.length}`,
  };
};

const getApprovedFaqs: ToolHandler = async (supabase, ctx) => {
  const { found, approved } = await loadProject(supabase, ctx);
  const { data } = await supabase
    .from('project_faqs')
    .select('question, answer, sort_order')
    .eq('project_id', ctx.projectId)
    .eq('tenant_id', ctx.tenantId)
    .order('sort_order', { ascending: true })
    .limit(MAX_ROWS);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    tool: 'getApprovedFaqs',
    data: rows.map((r) => ({ question: r.question, answer: r.answer })),
    freshnessAt: null,
    stale: !found,
    approved,
    summary: `faqs:${rows.length}`,
  };
};

export const TOOL_REGISTRY: Record<string, ToolHandler> = {
  getProjectOverview,
  getProjectConfigurations,
  getCurrentInventorySummary,
  getAvailableUnits,
  getCurrentPriceRange,
  getCurrentOffers,
  getProjectAmenities,
  getProjectLocationFacts,
  getProjectDocuments,
  getApprovedFaqs,
};

export type ToolName = keyof typeof TOOL_REGISTRY;

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
}

/**
 * Invoke a named tool. Rejects any name not in the allow-list. Tenant + project
 * are resolved server-side via the supplied RLS client; never from client input.
 */
export async function callTool(
  name: string,
  ctx: ToolContext,
  supabase?: SupabaseClient,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    // Never echo the untrusted name back; the allow-list is the boundary.
    throw new Error('unknown_tool');
  }
  const client = supabase ?? (await createSupabaseServerClient());
  return TOOL_REGISTRY[name]!(client, ctx);
}
