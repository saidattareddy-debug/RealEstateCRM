/**
 * Multilingual routing foundation (Phase 5A §16). Deterministic language
 * detection by script + a small Hinglish heuristic, plus a routing decision that
 * prefers same-language approved knowledge and falls back to English only where
 * the policy allows. Never claims a machine-translated source is native.
 */

export type SupportedLanguage = 'en' | 'hi' | 'kn' | 'ta' | 'te' | 'hinglish';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  'en',
  'hi',
  'kn',
  'ta',
  'te',
  'hinglish',
];

const HINGLISH_MARKERS = [
  'kya',
  'hai',
  'kaisa',
  'kaise',
  'kitna',
  'nahi',
  'haan',
  'acha',
  'theek',
  'bhai',
  'matlab',
];

/** Detect language by Unicode script ranges; Latin text with Hindi markers → Hinglish. */
export function detectLanguage(text: string): SupportedLanguage {
  if (/[ಀ-೿]/.test(text)) return 'kn'; // Kannada
  if (/[஀-௿]/.test(text)) return 'ta'; // Tamil
  if (/[ఀ-౿]/.test(text)) return 'te'; // Telugu
  if (/[ऀ-ॿ]/.test(text)) return 'hi'; // Devanagari (Hindi)
  const lower = text.toLowerCase();
  const markerHits = HINGLISH_MARKERS.filter((m) => new RegExp(`\\b${m}\\b`).test(lower)).length;
  if (markerHits >= 1) return 'hinglish';
  return 'en';
}

export interface LanguageRouteInput {
  requested: SupportedLanguage;
  /** Languages in which APPROVED, native (non-machine-translated) knowledge exists. */
  availableNative: readonly SupportedLanguage[];
  /** Policy allows falling back to approved English sources. */
  englishFallbackAllowed: boolean;
}

export interface LanguageRoute {
  /** Language to retrieve/answer in, or null when it must escalate. */
  outputLanguage: SupportedLanguage | null;
  usedFallback: boolean;
  escalate: boolean;
}

export function routeLanguage(input: LanguageRouteInput): LanguageRoute {
  const native = new Set(input.availableNative);
  // Hinglish can be served by Hindi or English native knowledge.
  if (input.requested === 'hinglish') {
    if (native.has('hinglish'))
      return { outputLanguage: 'hinglish', usedFallback: false, escalate: false };
    if (native.has('hi')) return { outputLanguage: 'hi', usedFallback: true, escalate: false };
    if (input.englishFallbackAllowed && native.has('en'))
      return { outputLanguage: 'en', usedFallback: true, escalate: false };
    return { outputLanguage: null, usedFallback: false, escalate: true };
  }
  if (native.has(input.requested)) {
    return { outputLanguage: input.requested, usedFallback: false, escalate: false };
  }
  if (input.englishFallbackAllowed && native.has('en')) {
    return { outputLanguage: 'en', usedFallback: true, escalate: false };
  }
  return { outputLanguage: null, usedFallback: false, escalate: true };
}
