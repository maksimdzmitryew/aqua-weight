import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Navigation & Error Resilience', () => {
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('404 handling for non-existent routes', async ({ page }) => {
    await page.goto('/non-existent-route-12345', { waitUntil: 'commit' });
    await expect(page.getByText(/404: Page Not Found/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go to dashboard/i })).toBeVisible();
  });

  test('API failure states: 500 error visibility', async ({ page }) => {
    // Mock all API calls to return 500
    await page.route('**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Internal Server Error' }),
        });
      }
      return route.continue();
    });

    await page.goto('/dashboard');
    // Wait for at least one API request to respond with 500 and for loading to finish
    await page.waitForResponse((res) => res.url().includes('/api/') && res.status() === 500);
    await expect(page.getByRole('status', { name: /loading/i })).not.toBeVisible();
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.getByText(/internal server error/i)).toBeVisible();
  });
});
