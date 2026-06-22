import { INVENTORY_STATUSES, type InventoryStatus } from './inventory';

/**
 * Pure CSV/XLSX import row mapping + validation for inventory units. The import
 * wizard maps arbitrary spreadsheet columns to these target fields; this module
 * turns a raw row into a validated unit or a per-row error (MASTER_SPEC §8, §10).
 */

export const UNIT_IMPORT_FIELDS = [
  'unit_number', // required
  'configuration_label',
  'status',
  'price',
  'carpet_area_sqft',
] as const;
export type UnitImportField = (typeof UNIT_IMPORT_FIELDS)[number];

/** mapping: target field -> source column header. */
export type ImportMapping = Partial<Record<UnitImportField, string>>;

export interface MappedUnit {
  unit_number: string;
  configuration_label?: string;
  status: InventoryStatus;
  price?: number;
  carpet_area_sqft?: number;
}

export type RowResult = { ok: true; value: MappedUnit } | { ok: false; error: string };

const STATUS_SYNONYMS: Record<string, InventoryStatus> = {
  available: 'available',
  open: 'available',
  free: 'available',
  hold: 'temporarily_held',
  held: 'temporarily_held',
  'temporarily held': 'temporarily_held',
  reserved: 'reserved',
  booked: 'booked',
  sold: 'sold',
  'sold out': 'sold',
  blocked: 'blocked',
  unavailable: 'unavailable',
  na: 'unavailable',
};

function normalizeStatus(raw: string | undefined): InventoryStatus | null {
  if (!raw) return 'available';
  const key = raw.trim().toLowerCase();
  if ((INVENTORY_STATUSES as readonly string[]).includes(key)) return key as InventoryStatus;
  return STATUS_SYNONYMS[key] ?? null;
}

function parseNumber(raw: string | undefined): number | null | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const cleaned = raw.replace(/[, ₹$]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Map + validate one raw row using the column mapping. */
export function mapAndValidateRow(raw: Record<string, string>, mapping: ImportMapping): RowResult {
  const get = (field: UnitImportField): string | undefined => {
    const col = mapping[field];
    return col ? raw[col]?.trim() : undefined;
  };

  const unitNumber = get('unit_number');
  if (!unitNumber) return { ok: false, error: 'Missing required field: unit_number' };

  const status = normalizeStatus(get('status'));
  if (status === null) return { ok: false, error: `Unrecognised status: "${get('status')}"` };

  const price = parseNumber(get('price'));
  if (price === null) return { ok: false, error: `Invalid price: "${get('price')}"` };

  const carpet = parseNumber(get('carpet_area_sqft'));
  if (carpet === null)
    return { ok: false, error: `Invalid carpet area: "${get('carpet_area_sqft')}"` };

  const value: MappedUnit = { unit_number: unitNumber, status };
  const config = get('configuration_label');
  if (config) value.configuration_label = config;
  if (typeof price === 'number') value.price = price;
  if (typeof carpet === 'number') value.carpet_area_sqft = carpet;
  return { ok: true, value };
}

export interface ImportResult {
  mapped: MappedUnit[];
  errors: { row: number; error: string }[];
}

/** Map a whole sheet (array of raw rows). 1-based row numbers in errors. */
export function mapRows(
  rows: readonly Record<string, string>[],
  mapping: ImportMapping,
): ImportResult {
  const mapped: MappedUnit[] = [];
  const errors: { row: number; error: string }[] = [];
  rows.forEach((raw, i) => {
    const res = mapAndValidateRow(raw, mapping);
    if (res.ok) mapped.push(res.value);
    else errors.push({ row: i + 1, error: res.error });
  });
  return { mapped, errors };
}
