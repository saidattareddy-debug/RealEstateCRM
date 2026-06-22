import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Embedded-PostgreSQL service-test project. Boots a real Postgres in-process and
 * runs the CANONICAL server services (e.g. `ingestConversationMessage`) against
 * it via the pg-backed Supabase shim — so triggers, constraints, RLS-bypassing
 * service-role semantics, and idempotency all execute for real.
 *
 * Note: NO runtime no-IO trap here (these tests legitimately open a localhost TCP
 * connection to the embedded Postgres). Long timeouts cover PG boot + migrations.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@re/validation': r('./packages/validation/src/index.ts'),
      '@re/config': r('./packages/config/src/index.ts'),
      '@re/domain': r('./packages/domain/src/index.ts'),
      '@': r('./apps/web/src'),
      'server-only': r('./apps/web/test/server-only-shim.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/web/test/**/*.pg.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
