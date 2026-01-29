import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Navigation State Persistence', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('search filter is preserved after navigating back from details', async ({ page }) => {
    await page.goto('/plants', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();

    // 1. Apply search filter
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Seed');

    // Verify only Seed Fern is shown
    await expect(page.getByRole('row', { name: /seed fern/i })).toBeVisible();

    // 2. Navigate to plant details
    await page.getByRole('row', { name: /seed fern/i }).getByRole('button', { name: /view/i }).click();
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: /seed fern/i })).toBeVisible();

    // 3. Navigate back via browser back button (tests browser history state)
    await page.goBack();
    await expect(page).toHaveURL(/\/plants/);

    // 4. Verify search filter and results are preserved
    await expect(searchInput).toHaveValue('Seed');
    await expect(page.getByRole('row', { name: /seed fern/i })).toBeVisible();
    await expect(page.getByRole('row', { name: /aloe/i })).not.toBeVisible();
  });
});
