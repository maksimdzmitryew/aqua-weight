import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Offline Resilience', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('simulate loss of network connectivity while mid-form', async ({ page, context }) => {
    await page.goto('/plants/new', { waitUntil: 'commit' });
    await expect(page.locator('h1')).toContainText(/create/i);

    // Fill some data
    await page.getByLabel(/name/i).fill('Offline Test Plant');
    await page.getByLabel(/description/i).fill('Testing offline resilience');

    // Go offline
    await context.setOffline(true);
    
    // Try to save
    await page.getByRole('button', { name: /save/i }).click();

    // Since we are offline, the API call should fail.
    // We check if the application displays an error message.
    // Based on PlantCreate.jsx: setFieldErrors({ general: 'Failed to save plant' }) 
    // when it's not an axios-like error with response.data.
    await expect(page.getByText(/failed to save plant/i)).toBeVisible();

    // Verify form state is preserved in the UI
    await expect(page.getByLabel(/name/i)).toHaveValue('Offline Test Plant');
    await expect(page.getByLabel(/description/i)).toHaveValue('Testing offline resilience');

    // Go back online
    await context.setOffline(false);

    // Try to save again
    await page.getByRole('button', { name: /save/i }).click();

    // Should succeed now
    await expect(page).toHaveURL(/\/plants$/);
    await expect(page.getByText('Offline Test Plant')).toBeVisible();
  });
});
