import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Plant History Management', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('delete measurement from history table', async ({ page }) => {
    // 1. Create a measurement
    await page.goto(`${ORIGIN}/measurement/weight`);
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('357');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page.getByRole('button', { name: /save measurement/i })).toHaveCount(0);

    // 2. Go to Plant Details
    await page.goto(`${ORIGIN}/plants`);
    await page.getByText('Seed Fern').click();
    
    // Verify we are on details page
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();
    
    // Find the measurement in the table
    const historyTable = page.locator('table').last();
    // Use .first() to handle multiple cells with the same value (e.g. measured_weight and last_dry_weight)
    await expect(historyTable.getByRole('cell', { name: '357' }).first()).toBeVisible();
    
    // 3. Delete the measurement
    // Identify the row with 357 and click its delete button
    const row = historyTable.getByRole('row', { name: /357/ });
    await row.getByRole('button', { name: /delete measurement/i }).click();
    
    // Confirm dialog
    await page.getByRole('dialog').getByRole('button', { name: /delete/i, exact: true }).click();
    
    // Verify it's gone
    await expect(historyTable.getByRole('cell', { name: '357' })).toHaveCount(0);
  });

  test('quick action buttons from details page', async ({ page }) => {
    await page.goto(`${ORIGIN}/plants`);
    await page.getByText('Seed Fern').click();
    
    // Click "Watering" quick action
    await page.getByRole('button', { name: /watering/i }).click();
    
    // Should navigate to watering form with plant preselected
    await expect(page).toHaveURL(/\/measurement\/watering\?plant=/);
    await expect(page.getByLabel(/plant/i)).toHaveValue(/[a-f0-9-]{32,36}/);
    
    // Go back
    await page.goBack();
    
    // Click "Repotting" quick action
    await page.getByRole('button', { name: /repotting/i }).click();
    await expect(page).toHaveURL(/\/measurement\/repotting\?plant=/);
  });
});
