import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Dashboard Controls', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN);
    await page.goto('/dashboard');
  });

  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('reference line toggles update sparkline', async ({ page }) => {
    // 1. Setup measurements on different days
    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('300');
    await page.getByLabel(/measured at/i).fill('2025-01-01T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page.getByRole('button', { name: /save measurement/i })).toHaveCount(0);
    
    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('280');
    await page.getByLabel(/measured at/i).fill('2025-01-02T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page.getByRole('button', { name: /save measurement/i })).toHaveCount(0);

    // 2. Setup watering to establish max_water_weight_g
    await page.goto('/measurement/watering');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/current weight/i).fill('500'); // last_wet_weight_g
    await page.getByLabel(/weight before watering/i).fill('280'); // last_dry_weight_g
    await page.getByLabel(/water added/i).fill('220');
    await page.getByRole('button', { name: /save watering/i }).click();
    await expect(page.getByRole('button', { name: /save watering/i })).toHaveCount(0);

    // 3. Go to Dashboard and verify sparkline
    await page.goto('/dashboard');
    const sparkline = page.locator('svg').first();
    await expect(sparkline).toBeVisible({ timeout: 15000 });

    const countRefLines = async () => {
      return await sparkline.locator('line[stroke-dasharray="4 3"]').count();
    };

    // We should have at least Dry and Max
    await expect(async () => {
        expect(await countRefLines()).toBeGreaterThan(0);
    }).toPass();
    const initialCount = await countRefLines();

    // Toggle "Show min dry weight"
    await page.getByLabel(/show min dry weight/i).uncheck();
    await expect(async () => {
        expect(await countRefLines()).toBe(initialCount - 1);
    }).toPass();

    // Toggle "Show max water weight"
    await page.getByLabel(/show max water weight/i).uncheck();
    await expect(async () => {
        expect(await countRefLines()).toBe(initialCount - 2);
    }).toPass();
  });

  test('charts per row selector updates grid layout', async ({ page }) => {
    const grid = page.locator('.main > div').last(); // The grid container
    
    // Change to 1 chart per row
    await page.getByLabel(/charts per row/i).selectOption('1');
    await expect(grid).toHaveCSS('display', 'grid');
    // It might resolve to "repeat(1, minmax(0px, 1fr))" or "976px" if the browser calculates it.
    // Let's check for grid-template-columns presence.
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(1,/);

    // Change to 3 charts per row
    await page.getByLabel(/charts per row/i).selectOption('3');
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(3,/);
    
    // Persistence check
    await page.reload();
    await expect(page.getByLabel(/charts per row/i)).toHaveValue('3');
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(3,/);
  });

  test('clicking plant card navigates to stats page', async ({ page }) => {
    await page.getByText(/seed fern/i).first().click();
    await expect(page).toHaveURL(/\/stats\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: /seed fern/i })).toBeVisible();
  });
});
