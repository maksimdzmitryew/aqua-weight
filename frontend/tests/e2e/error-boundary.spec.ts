import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Navigation & Error Resilience', () => {
  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('404 handling for non-existent routes', async ({ page }) => {
    await page.goto('/non-existent-route-12345');
    
    await expect(page.getByText(/404: Page Not Found/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go to dashboard/i })).toBeVisible();
  });

  test('API failure states: 500 error visibility', async ({ page }) => {
    // Mock API to return 500
    await page.route('**/api/plants', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Internal Server Error' }),
    }));

    await page.goto('/dashboard');
    
    // Check if ErrorNotice is visible
    await expect(page.getByText(/internal server error/i)).toBeVisible();
  });
});
