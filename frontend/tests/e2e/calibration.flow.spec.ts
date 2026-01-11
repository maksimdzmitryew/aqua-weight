import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Calibration Flow', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await seed(ORIGIN);
    
    // 1. Create a NEW plant
    await page.goto(`${ORIGIN}/plants/new`);
    await page.getByLabel(/name/i).fill('Calibration Plant');
    await page.getByLabel(/location/i).selectOption('11111111111111111111111111111111');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/plants/);

    // 2. Establish baseline via a weight measurement (dry weight)
    await page.goto(`${ORIGIN}/measurement/weight`);
    await page.getByLabel(/plant/i).selectOption({ label: 'Calibration Plant' });
    await page.getByLabel(/measured weight \(g\)/i).fill('200');
    await page.getByLabel(/measured at/i).fill('2025-01-01T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    // 3. Establish LARGE max water via a watering event
    await page.goto(`${ORIGIN}/measurement/watering`);
    await page.getByLabel(/plant/i).selectOption({ label: 'Calibration Plant' });
    await page.getByLabel(/measured at/i).fill('2025-01-01T11:00');
    await page.getByLabel(/current weight/i).fill('400'); // 200g water
    await page.getByRole('button', { name: /save watering/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/watering/);

    // Now min_dry=200, max_water=200.

    // 4. MANUALLY REDUCE max_water_weight_g to 100g to create an overfill
    await page.goto(`${ORIGIN}/plants`);
    await page.getByRole('row', { name: /calibration plant/i }).getByRole('button', { name: /edit/i }).click();
    await page.getByRole('tab', { name: /calculated/i }).click();
    await page.getByLabel(/max water weight/i).fill('100');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/plants/);

    // Now target is 200+100=300. The 400g watering event is now an OVERFILL (+100).
    await page.close();
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('full overfill correction flow', async ({ page }) => {
    // 5. Navigate to calibration
    await page.goto('/calibration');
    await page.waitForLoadState('networkidle');

    // To see overfills (where under_g is 0), we MUST check this filter
    await page.getByLabel(/zero Below Max Water, all/i).check();
    
    // Also check underwatered just in case
    await page.getByLabel(/underwatered/i).check();
    
    // Verify overfill is shown (Diff to max Weight will be +100)
    await expect(page.getByRole('cell', { name: '+100' })).toBeVisible({ timeout: 15000 });

    const correctBtn = page.locator('.card').filter({ hasText: /calibration plant/i }).getByRole('button', { name: /correct overfill/i });
    await correctBtn.click();

    // After resolution, it should refresh and the +100 row should be gone
    await expect(page.getByRole('cell', { name: '+100' })).toHaveCount(0, { timeout: 15000 });
  });
});
