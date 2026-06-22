import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  nameSimilarity,
  classifyPair,
  findDuplicates,
  bestDuplicate,
  type ContactKey,
} from '../dedupe';

describe('normalizePhone', () => {
  it('normalizes 10-digit Indian numbers to E.164 + national', () => {
    expect(normalizePhone('9812345678')).toEqual({ e164: '+919812345678', national: '9812345678' });
  });
  it('handles +91, spaces, and leading zero', () => {
    expect(normalizePhone('+91 98123 45678').e164).toBe('+919812345678');
    expect(normalizePhone('098123 45678')).toEqual({
      e164: '+919812345678',
      national: '9812345678',
    });
  });
  it('returns nulls for unusable input', () => {
    expect(normalizePhone('123')).toEqual({ e164: null, national: null });
    expect(normalizePhone(null)).toEqual({ e164: null, national: null });
  });
});

describe('nameSimilarity', () => {
  it('ignores honorifics and order', () => {
    expect(nameSimilarity('Mr Rahul Sharma', 'Sharma Rahul')).toBe(1);
  });
  it('is low for different names', () => {
    expect(nameSimilarity('Rahul Sharma', 'Priya Mehta')).toBe(0);
  });
});

const base: ContactKey = {
  id: 'L1',
  fullName: 'Rahul Sharma',
  phoneE164: '+919812345678',
  phoneNational: '9812345678',
  email: 'rahul@example.com',
  source: 'meta',
  sourceLeadId: 'M-100',
  campaign: 'C1',
  createdAt: '2026-06-19T10:00:00Z',
};

describe('classifyPair', () => {
  it('exact on same E.164 phone', () => {
    const inc: ContactKey = { ...base, id: 'X', email: null };
    expect(classifyPair(inc, base)?.confidence).toBe('exact');
  });
  it('exact on same email even if phone differs', () => {
    const inc: ContactKey = {
      ...base,
      id: 'X',
      phoneE164: '+910000000000',
      phoneNational: '0000000000',
    };
    expect(classifyPair(inc, base)?.confidence).toBe('exact');
  });
  it('probable on same source lead id', () => {
    const inc: ContactKey = {
      id: 'X',
      fullName: 'Different Name',
      phoneE164: '+910000000000',
      phoneNational: '0000000000',
      email: null,
      source: 'meta',
      sourceLeadId: 'M-100',
    };
    expect(classifyPair(inc, base)?.confidence).toBe('probable');
  });
  it('probable on national phone + fuzzy name (no full E.164/email match)', () => {
    const inc: ContactKey = {
      id: 'X',
      fullName: 'Rahul Sharma',
      phoneE164: null,
      phoneNational: '9812345678',
      email: null,
    };
    const ex: ContactKey = { ...base, email: null };
    expect(classifyPair(inc, ex)?.confidence).toBe('probable');
  });
  it('possible on national phone alone', () => {
    const inc: ContactKey = {
      id: 'X',
      fullName: 'Totally Other',
      phoneNational: '9812345678',
      email: null,
    };
    const ex: ContactKey = { ...base, email: null, phoneE164: null };
    expect(classifyPair(inc, ex)?.confidence).toBe('possible');
  });
  it('possible on fuzzy name + same campaign within window', () => {
    const inc: ContactKey = {
      id: 'X',
      fullName: 'Rahul Sharma',
      phoneNational: '0000000000',
      email: null,
      campaign: 'C1',
      createdAt: '2026-06-19T20:00:00Z',
    };
    const ex: ContactKey = { ...base, email: null, phoneE164: null, phoneNational: '1111111111' };
    expect(classifyPair(inc, ex)?.confidence).toBe('possible');
  });
  it('no match for unrelated leads', () => {
    const inc: ContactKey = {
      id: 'X',
      fullName: 'Priya Mehta',
      phoneNational: '2223334445',
      email: 'priya@x.com',
    };
    expect(classifyPair(inc, base)).toBeNull();
  });
});

describe('findDuplicates / bestDuplicate', () => {
  it('ranks exact above possible and excludes self', () => {
    const inc: ContactKey = { ...base, id: 'INC' };
    const pool: ContactKey[] = [
      { ...base, id: 'INC' }, // same id as incoming → must be excluded
      { id: 'possible', fullName: 'x', phoneE164: null, phoneNational: '9812345678', email: null },
      { id: 'exact', fullName: 'whoever', email: base.email },
    ];
    const res = findDuplicates(inc, pool);
    expect(res.find((r) => r.leadId === 'INC')).toBeUndefined();
    expect(res[0]?.confidence).toBe('exact');
    expect(bestDuplicate(inc, pool)?.leadId).toBe('exact');
  });
});
