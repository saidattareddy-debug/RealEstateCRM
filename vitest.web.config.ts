import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Dedicated apps/web SERVER test project. Separate from the packages-only
 * `vitest.config.ts` because these tests exercise server services that import
 * `server-only` (aliased to a no-op here) and run with a runtime no-external-IO
 * trap installed in `setup.web.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@re/validation': r('./packages/validation/src/index.ts'),
      '@re/config': r('./packages/config/src/index.ts'),
      '@re/domain': r('./packages/domain/src/index.ts'),
      '@': r('./apps/web/src'),
      // `server-only` is a build-time marker module; make it a no-op under test.
      'server-only': r('./apps/web/test/server-only-shim.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/web/test/**/*.web.test.ts'],
    setupFiles: ['apps/web/test/setup.web.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
