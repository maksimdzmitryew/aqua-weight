import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Specialized Creations', () => {
  test.beforeEach(async () => {
    await seed(ORIGIN);
  });
  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('repotting: create and verify in plant details', async ({ page }) => {
    // 1. Create a base weight measurement because backend requires a previous event for repotting
    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('350');
    await page.getByRole('button', { name: /save measurement/i }).click();
    // Redirect might be back to /plants or plant details depending on history
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    // 2. Perform repotting
    await page.goto('/measurement/repotting');
    // DashboardLayout doesn't always use h1 for title, let's just check for text
    await expect(page.getByText('Repotting', { exact: true })).toBeVisible();

    // Select "Seed Fern"
    const plantSelect = page.getByLabel(/plant/i);
    await plantSelect.selectOption({ label: 'Seed Fern' });
    await plantSelect.blur();
    
    // Fill weights
    const beforeInput = page.getByLabel(/weight before repotting/i);
    await beforeInput.fill('300');
    await beforeInput.blur();
    
    const afterInput = page.getByLabel(/weight after repotting/i);
    await afterInput.fill('450');
    await afterInput.blur();
    
    // Save
    const saveBtn = page.getByRole('button', { name: /save repotting/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Should navigate to plant details
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();
    
    // Verify measurement is in history
    // Repotting creates multiple measurements (3 inserts in backend)
    const historyTable = page.locator('table').last();
    // Header + 1 base + 3 repotting = 5 rows
    await expect(historyTable.getByRole('row')).toHaveCount(5, { timeout: 10000 });
    // Use .first() because 450 appears in both "measured_weight" and "last_wet_weight" logic sometimes
    await expect(historyTable.getByRole('cell', { name: '450' }).first()).toBeVisible();
  });

  test('single watering: create and verify in plant details', async ({ page }) => {
    // 1. Create a base weight measurement because derive_weights might need it
    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('350');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    // 2. Perform watering
    await page.goto('/measurement/watering');
    // Check for "Watering" in layout
    await expect(page.getByText('Watering', { exact: true })).toBeVisible();

    // Select "Seed Fern"
    const plantSelect = page.getByLabel(/plant/i);
    await plantSelect.selectOption({ label: 'Seed Fern' });
    await plantSelect.blur();
    
    // Fill current weight
    const currentInput = page.getByLabel(/current weight/i);
    await currentInput.fill('600');
    await currentInput.blur();
    
    // Save
    const saveBtn = page.getByRole('button', { name: /save watering/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Should navigate to plant details
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();
    
    // Verify measurement is in history
    const historyTable = page.locator('table').last();
    await expect(historyTable.getByRole('row')).toHaveCount(3, { timeout: 10000 }); // Header + 1 base + 1 watering = 3
    await expect(historyTable.getByRole('cell', { name: '600' }).first()).toBeVisible();
  });
});
