import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@re/validation': r('./packages/validation/src/index.ts'),
      '@re/config': r('./packages/config/src/index.ts'),
      '@re/domain': r('./packages/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
