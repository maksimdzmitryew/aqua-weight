import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://localhost:5173';

test.describe('Daily care', () => {
  test.beforeEach(async () => { await seed(ORIGIN); });
  test.afterEach(async () => { await cleanup(ORIGIN); });

  test('shows tasks that need watering and allows navigation to bulk actions', async ({ page }) => {
    await page.goto('/daily');

    // Header should be visible
    await expect(page.getByRole('heading', { name: /daily care/i })).toBeVisible();

    // With minimal seed, water_retained_pct is unknown → treated as needs watering
    // Button should display a count in parentheses
    const bulkWateringBtn = page.getByRole('button', { name: /bulk watering/i });
    await expect(bulkWateringBtn).toBeVisible();
    await expect(bulkWateringBtn).toContainText(/\(\d+\)/);

    // Table with tasks should be visible and contain at least one row
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // There should be at least one cell indicating it needs watering
    await expect(page.getByLabel(/needs watering/i).first()).toBeVisible();

    // Also verify measurement button is present (count might be 0)
    await expect(page.getByRole('button', { name: /bulk measurement/i })).toBeVisible();

    // Navigate to bulk watering via button click
    await bulkWateringBtn.click();
    // Bulk watering page should load (has a table of plants to water)
    await expect(page.getByRole('heading', { name: /bulk watering/i })).toBeVisible({ timeout: 10_000 });
  });
});
