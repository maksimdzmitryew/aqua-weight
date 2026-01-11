import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Bulk Watering Styles', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await seed(ORIGIN);
    
    // Plant 1: Thirsty (Seed Fern)
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle');
    await page.getByRole('row', { name: /seed fern/i }).getByRole('button', { name: /edit/i }).click();
    await page.getByRole('tab', { name: /calculated/i }).click();
    await page.getByLabel(/recommended water threshold/i).fill('50');
    await page.getByLabel(/min dry weight/i).fill('200');
    await page.getByLabel(/max water weight/i).fill('100');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/plants/);

    await page.getByRole('row', { name: /seed fern/i }).getByRole('button', { name: /watering/i }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/current weight/i).fill('225'); // 25% < 50%
    await page.getByRole('button', { name: /save watering/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/watering/);

    // Plant 2: Satisfied (New Plant)
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /\+\s*Create/i }).click();
    await page.getByLabel(/name/i).fill('Satisfied Plant');
    await page.getByLabel(/location/i).selectOption('11111111111111111111111111111111');
    await page.getByRole('tab', { name: /care/i }).click();
    await page.getByLabel(/recommended water threshold/i).fill('20');
    await page.getByRole('tab', { name: /calculated/i }).click();
    await page.getByLabel(/min dry weight/i).fill('200');
    await page.getByLabel(/max water weight/i).fill('100');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/plants/);

    await page.getByRole('row', { name: /satisfied plant/i }).getByRole('button', { name: /measurement/i }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/measured weight/i).fill('280'); // 80% > 20%
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);
    await page.close();
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('conditional styling in bulk watering show all mode', async ({ page }) => {
    await page.goto('/measurements/bulk/watering', { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/show all plants/i).check();

    const needsWaterRow = page.getByRole('row').filter({ hasText: /seed fern/i });
    const satisfiedRow = page.getByRole('row').filter({ hasText: /satisfied plant/i });

    await expect(needsWaterRow.getByText(/needs water/i)).toBeVisible();
    
    // Check for opacity.
    await expect(satisfiedRow).toBeVisible();
    
    // Check computed style for opacity
    const opacity = await satisfiedRow.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeCloseTo(0.55, 1);
  });
});
