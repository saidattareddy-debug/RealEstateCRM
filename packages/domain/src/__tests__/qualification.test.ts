import { describe, it, expect } from 'vitest';
import { computeCompleteness, type QualField } from '../qualification';

const fields: QualField[] = [
  { key: 'full_name', importance: 'required' },
  { key: 'primary_phone', importance: 'required' },
  { key: 'primary_email', importance: 'important' },
  { key: 'budget', importance: 'important' },
  { key: 'purpose', importance: 'optional' },
  { key: 'unused', importance: 'disabled' },
];

describe('computeCompleteness', () => {
  it('separates required / important / overall and lists missing', () => {
    const r = computeCompleteness(fields, {
      full_name: 'Asha',
      primary_phone: '9811112222',
      primary_email: '',
      budget: '5000000',
    });
    expect(r.requiredPct).toBe(100);
    expect(r.importantPct).toBe(50); // budget present, email blank
    // active = 5 (disabled excluded); filled = full_name, phone, budget = 3
    expect(r.overallPct).toBe(60);
    expect(r.missingRequired).toEqual([]);
    expect(r.missingImportant).toEqual(['primary_email']);
  });

  it('treats blank strings as missing and ignores disabled fields', () => {
    const r = computeCompleteness(fields, {});
    expect(r.requiredPct).toBe(0);
    expect(r.missingRequired).toEqual(['full_name', 'primary_phone']);
    expect(r.overallPct).toBe(0);
  });

  it('is not a quality score (100% with required only)', () => {
    const r = computeCompleteness([{ key: 'a', importance: 'required' }], { a: 'x' });
    expect(r.overallPct).toBe(100);
  });
});
