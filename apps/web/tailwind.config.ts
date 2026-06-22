import type { Config } from 'tailwindcss';

// Colours map to CSS variables defined in @re/ui/tokens.css so tenant branding
// can override them at runtime (docs/UI_SYSTEM.md §2).
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-app': 'var(--color-bg-app)',
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        forest: 'var(--color-forest)',
        'forest-deep': 'var(--color-forest-deep)',
        champagne: 'var(--color-champagne)',
        terracotta: 'var(--color-terracotta)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        border: 'var(--color-border)',
      },
      borderRadius: {
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
