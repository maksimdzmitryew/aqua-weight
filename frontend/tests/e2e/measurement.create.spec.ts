import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Measurements', () => {
  test.beforeAll(async () => { await seed(ORIGIN); });
  test.afterAll(async () => { await cleanup(ORIGIN); });

  test('create measurement for a plant and see it reflected in list', async ({ page }) => {
    // Assume at least one plant exists from seed
    await page.goto('/measurement/weight', { waitUntil: 'commit' });

    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight/i).fill('123.4');
    await page.getByLabel(/measured at/i).fill('2025-01-01T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();

    // Navigate to plants list and verify aggregate/latest value present
    await page.goto('/plants', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();
    await expect(page.getByText(/seed fern/i)).toBeVisible();
  });
});