import { describe, it, expect } from 'vitest';
import { chunkDocument, normalizeText, fnv1aHex } from '../chunking';

describe('chunking', () => {
  it('is reproducible: identical input + config → identical chunks and checksums', () => {
    const input = { text: '# A\n\nHello world.\n\n# B\n\nMore text.', language: 'en' };
    const a = chunkDocument(input);
    const b = chunkDocument(input);
    expect(a).toEqual(b);
    expect(a.map((c) => c.checksum)).toEqual(b.map((c) => c.checksum));
  });

  it('splits by headings and preserves the section heading', () => {
    const c = chunkDocument({
      text: '# Overview\n\nPara one.\n\n# Amenities\n\nPool.',
      language: 'en',
    });
    expect(c.map((x) => x.heading)).toEqual(['Overview', 'Amenities']);
  });

  it('keeps a numbered payment-plan list atomic (does not split steps)', () => {
    const text =
      '# Payment Plan\n\n1. 10% on booking\n2. 40% on construction\n3. 50% on possession';
    const c = chunkDocument({ text, language: 'en' }, { maxChars: 20 });
    const planChunks = c.filter((x) => x.heading === 'Payment Plan');
    // The whole list stays in a single chunk despite the tiny maxChars.
    expect(planChunks).toHaveLength(1);
    expect(planChunks[0]!.text).toContain('50% on possession');
  });

  it('never breaks an over-long URL token', () => {
    const url = 'https://example.com/' + 'a'.repeat(2000);
    const c = chunkDocument({ text: url, language: 'en' }, { maxChars: 100 });
    expect(c).toHaveLength(1);
    expect(c[0]!.text).toBe(url);
  });

  it('splits a long prose paragraph on sentence boundaries', () => {
    const text = 'Sentence one is here. ' + 'Sentence two is here. '.repeat(60);
    const c = chunkDocument({ text, language: 'en' }, { maxChars: 200 });
    expect(c.length).toBeGreaterThan(1);
    // No chunk wildly exceeds the soft max (single sentences are small here).
    expect(c.every((x) => x.text.length <= 260)).toBe(true);
  });

  it('handles empty and whitespace-only input', () => {
    expect(chunkDocument({ text: '', language: 'en' })).toEqual([]);
    expect(chunkDocument({ text: '   \n\n  ', language: 'en' })).toEqual([]);
  });

  it('preserves language and produces token estimates', () => {
    const c = chunkDocument({ text: 'नमस्ते दुनिया', language: 'hi' });
    expect(c[0]!.language).toBe('hi');
    expect(c[0]!.tokenEstimate).toBeGreaterThan(0);
  });

  it('repeated content yields stable distinct chunk indices', () => {
    const c = chunkDocument({ text: '# H\n\nSame.\n\nSame.', language: 'en' }, { maxChars: 5 });
    expect(c.map((x) => x.index)).toEqual([0, 1]);
  });

  it('normalizeText collapses CRLF and blank runs', () => {
    expect(normalizeText('a\r\n\r\n\r\n\r\nb  \r\n')).toBe('a\n\nb');
  });

  it('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1aHex('hello')).toBe(fnv1aHex('hello'));
    expect(fnv1aHex('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex('hello')).not.toBe(fnv1aHex('world'));
  });

  it('chunks each supported script without corrupting characters', () => {
    const samples: [string, string][] = [
      ['hi', 'नमस्ते, यह नॉर्थविंड ग्रीन्स परियोजना है।'],
      ['kn', 'ಹಲೋ, ಇದು ನಾರ್ತ್‌ವಿಂಡ್ ಗ್ರೀನ್ಸ್ ಯೋಜನೆ.'],
      ['ta', 'வணக்கம், இது நார்த்விண்ட் கிரீன்ஸ் திட்டம்.'],
      ['te', 'నమస్తే, ఇది నార్త్‌విండ్ గ్రీన్స్ ప్రాజెక్ట్.'],
      ['hinglish', 'Northwind Greens ka 3 BHK kitne ka hai bhai?'],
    ];
    for (const [lang, text] of samples) {
      const c = chunkDocument({ text, language: lang });
      expect(c).toHaveLength(1);
      expect(c[0]!.text).toBe(text); // no truncation / corruption
      expect(c[0]!.language).toBe(lang);
    }
  });

  it('keeps a price with its currency and unit (never splits mid-line)', () => {
    const text = '# Price\n\nThe 3 BHK is priced at ₹95,00,000 (all-inclusive) for 1380 sq ft.';
    const c = chunkDocument({ text, language: 'en' }, { maxChars: 20 });
    expect(c).toHaveLength(1);
    expect(c[0]!.text).toContain('₹95,00,000 (all-inclusive) for 1380 sq ft');
  });

  it('keeps a text table block atomic', () => {
    const text = '# Units\n\n| Unit | Area | Price |\n| A-1 | 980 | 65L |\n| B-2 | 1380 | 95L |';
    const c = chunkDocument({ text, language: 'en' }, { maxChars: 15 });
    const unitChunks = c.filter((x) => x.heading === 'Units');
    expect(unitChunks).toHaveLength(1);
    expect(unitChunks[0]!.text).toContain('B-2');
  });

  it('keeps FAQ question/answer pairs together', () => {
    const text = 'Q: Is there a clubhouse?\nA: Yes, a 10,000 sq ft clubhouse is included.';
    const c = chunkDocument({ text, language: 'en', isFaq: true }, { maxChars: 10 });
    expect(c).toHaveLength(1);
    expect(c[0]!.text).toContain('Q: Is there a clubhouse?');
    expect(c[0]!.text).toContain('A: Yes');
  });
});
