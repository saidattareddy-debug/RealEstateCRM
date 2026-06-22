import { describe, it, expect } from 'vitest';
import { isOfferable, isStale, summarizeAvailability, type UnitLike } from '../inventory';
import { mapAndValidateRow, mapRows } from '../import-mapping';

describe('inventory availability', () => {
  it('only `available` is offerable', () => {
    expect(isOfferable('available')).toBe(true);
    for (const s of [
      'temporarily_held',
      'reserved',
      'booked',
      'sold',
      'blocked',
      'unavailable',
    ] as const) {
      expect(isOfferable(s)).toBe(false);
    }
  });

  it('isStale respects the freshness window', () => {
    const now = new Date('2026-06-19T12:00:00Z');
    expect(isStale('2026-06-19T11:00:00Z', 24, now)).toBe(false); // 1h old
    expect(isStale('2026-06-17T11:00:00Z', 24, now)).toBe(true); // ~49h old
  });

  it('summarizeAvailability separates offerable (fresh) from stale', () => {
    const now = new Date('2026-06-19T12:00:00Z');
    const units: UnitLike[] = [
      { status: 'available', lastVerifiedAt: '2026-06-19T11:00:00Z' }, // fresh
      { status: 'available', lastVerifiedAt: '2026-06-15T11:00:00Z' }, // stale
      { status: 'booked', lastVerifiedAt: now },
      { status: 'sold', lastVerifiedAt: now },
    ];
    const s = summarizeAvailability(units, 24, now);
    expect(s.total).toBe(4);
    expect(s.available).toBe(2);
    expect(s.offerable).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.byStatus.booked).toBe(1);
    expect(s.byStatus.sold).toBe(1);
  });
});

describe('inventory import mapping', () => {
  const mapping = {
    unit_number: 'Unit',
    status: 'Status',
    price: 'Price',
    carpet_area_sqft: 'Carpet',
    configuration_label: 'Type',
  };

  it('maps a clean row and normalises status synonyms + currency', () => {
    const res = mapAndValidateRow(
      { Unit: 'A-101', Status: 'Sold Out', Price: '₹65,00,000', Carpet: '980', Type: '2 BHK' },
      mapping,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.unit_number).toBe('A-101');
      expect(res.value.status).toBe('sold');
      expect(res.value.price).toBe(6500000);
      expect(res.value.carpet_area_sqft).toBe(980);
      expect(res.value.configuration_label).toBe('2 BHK');
    }
  });

  it('defaults missing status to available', () => {
    const res = mapAndValidateRow({ Unit: 'A-1' }, { unit_number: 'Unit' });
    expect(res.ok && res.value.status).toBe('available');
  });

  it('rejects missing unit_number and bad values', () => {
    expect(mapAndValidateRow({ Status: 'available' }, mapping).ok).toBe(false);
    expect(mapAndValidateRow({ Unit: 'A-2', Price: 'abc' }, mapping).ok).toBe(false);
    expect(mapAndValidateRow({ Unit: 'A-3', Status: 'weird' }, mapping).ok).toBe(false);
  });

  it('mapRows reports per-row errors with 1-based row numbers', () => {
    const rows: Record<string, string>[] = [
      { Unit: 'A-1' },
      { Status: 'available' },
      { Unit: 'A-3', Price: 'x' },
    ];
    const out = mapRows(rows, mapping);
    expect(out.mapped).toHaveLength(1);
    expect(out.errors).toEqual([
      { row: 2, error: 'Missing required field: unit_number' },
      { row: 3, error: 'Invalid price: "x"' },
    ]);
  });
});
