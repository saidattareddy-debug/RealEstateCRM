import { test, expect, type Page } from '@playwright/test';

/**
 * Controlled-MVP browser smoke skeleton (staging only). Covers the parts that can
 * be automated without real provider IO. Credentials come from server-only env —
 * never hard-coded. Full 35-step workflow is in docs/CONTROLLED_MVP_SMOKE_TEST.md.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

async function signIn(page: Page) {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not configured');
  await page.goto('/sign-in');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/dashboard|inbox|leads/);
}

test('sign-in page is available', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('protected route redirects unauthenticated users', async ({ page }) => {
  await page.goto('/leads');
  await expect(page).toHaveURL(/sign-in/);
});

test('health endpoint reports controlled-MVP posture and no secrets', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.profile).toBe('controlled_mvp');
  expect(body.publicWebhooks).toBe('disabled');
  expect(body.liveSending).toBe('disabled');
  expect(JSON.stringify(body)).not.toMatch(/service_role|secret|token/i);
});

test.describe('authenticated shell', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  for (const path of [
    '/projects',
    '/leads',
    '/pipeline',
    '/tasks',
    '/inbox',
    '/scoring/test-lab',
    '/matching/test-lab',
    '/settings/integrations',
  ]) {
    test(`loads ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
    });
  }

  test('integration settings show simulation-only posture', async ({ page }) => {
    await page.goto('/settings/integrations');
    await expect(page.getByText(/TEST MODE|SIMULATION/i)).toBeVisible();
    await expect(page.getByTestId('public-webhooks-status')).toContainText(/disabled/i);
    // No automatic-send control is present/enabled in controlled MVP.
    await expect(page.getByRole('button', { name: /send.*live|enable.*sending/i })).toHaveCount(0);
  });
});
