import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Session Timeout & Re-authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('UI handles 401 Unauthorized by showing error message', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'commit' });
    
    // Intercept any API call and return 401
    await page.route('**/api/plants', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Session expired' }),
      });
    });

    // Reload or navigate to trigger the request
    await page.goto('/dashboard', { waitUntil: 'commit' });

    // Verification: Ensure the UI shows a "Session Expired" notification or equivalent error message
    // Based on Dashboard.jsx code: {error && <ErrorNotice message={error} />}
    const errorNotice = page.locator('[role="alert"]');
    await expect(errorNotice).toBeVisible();
    await expect(errorNotice).toContainText(/session expired/i);
  });
});
