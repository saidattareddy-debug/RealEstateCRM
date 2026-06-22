import { defineConfig, devices } from '@playwright/test';

/**
 * Controlled-MVP smoke automation. Runs against a STAGING deployment only.
 * No credentials are embedded here — the base URL and staging test accounts are
 * supplied through server-only environment variables at run time:
 *   E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD (set in CI/staging secrets).
 * Browsers are installed separately (`pnpm exec playwright install`); this repo
 * only ships the compilable test skeleton (`pnpm test:e2e:compile`).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e/.report/smoke.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
