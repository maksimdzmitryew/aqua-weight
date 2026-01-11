import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Plant Details & Stats', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('navigation, content verification and stats', async ({ page }) => {
    // 1. Navigation from Plants List
    await page.goto('/plants');
    // Click on "Seed Fern" - assume it's there from minimal seed
    await page.getByRole('link', { name: 'Seed Fern' }).click();
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();

    // 2. Content Verification in Details
    // Use exact to avoid matching "Locations" link in sidebar
    await expect(page.getByText('Location', { exact: true })).toBeVisible();
    await expect(page.getByText('Living Room')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Measurements/i })).toBeVisible();
    
    // Seeded plant has no measurements initially by default, or maybe one from seed-minimal?
    // According to seed-minimal, only plant and location are created.
    await expect(page.getByText(/No measurements yet/i)).toBeVisible();

    // 3. Stats Page
    // Route for Stats is /stats/:uuid
    const url = page.url();
    const uuid = url.split('/').pop();
    await page.goto(`/stats/${uuid}`);
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();
    await expect(page.getByText(/Weight since last repotting/i)).toBeVisible();
    
    // Verify sparkline container
    // Since there are no measurements, it should show "Not enough data to chart"
    await expect(page.getByText(/Not enough data to chart/i)).toBeVisible();
  });
});
