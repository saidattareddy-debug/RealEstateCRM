/**
 * Design tokens — the single source of truth for the premium real-estate
 * light theme (docs/UI_SYSTEM.md §2). Tenant branding overrides primary/
 * secondary/accent at runtime via CSS variables; these are the fallbacks.
 */

export const lightTheme = {
  bgApp: '#F6F4EF',
  surface: '#FFFFFF',
  surfaceElevated: '#FCFBF8',
  textPrimary: '#202522',
  textSecondary: '#66706A',
  forest: '#274D3D',
  forestDeep: '#18372B',
  champagne: '#B79257',
  terracotta: '#C95D4B',
  success: '#2F7D5B',
  warning: '#C38A2E',
  border: '#E4E1D9',
} as const;

/** Refined dark theme — deep warm neutrals, never pure black. */
export const darkTheme = {
  bgApp: '#141715',
  surface: '#1B1F1C',
  surfaceElevated: '#222724',
  textPrimary: '#ECEAE3',
  textSecondary: '#A2ABA4',
  forest: '#5C9B7E',
  forestDeep: '#3E6E58',
  champagne: '#CBA877',
  terracotta: '#D9745F',
  success: '#5BB088',
  warning: '#D7A957',
  border: '#2E332F',
} as const;

export type ThemeTokens = typeof lightTheme;

export const radius = { sm: '8px', md: '12px', lg: '16px' } as const;

/** Lead category → token name mapping used by badges/pills. */
export const categoryColor = {
  Hot: 'terracotta',
  Warm: 'champagne',
  Cold: 'textSecondary',
  Disqualified: 'border',
} as const;
