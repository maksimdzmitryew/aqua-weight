import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Sparkline Edge Cases', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('render sparklines with extreme data points', async ({ page }) => {
    // We want to test a plant with extreme data points.
    // Instead of seeding the DB with them, we can mock the API response.
    const extremeData = [
      { id: 1, measured_at: '2026-01-01 10:00:00', measured_weight_g: 1000 },
      { id: 2, measured_at: '2026-01-02 10:00:00', measured_weight_g: 1000000 }, // Massive jump
      { id: 3, measured_at: '2026-01-03 10:00:00', measured_weight_g: 0 },       // Zero weight
      { id: 4, measured_at: '2026-01-04 10:00:00', measured_weight_g: 500000 }
    ];

    await page.route('**/api/plants/*/measurements', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(extremeData),
      });
    });

    // Go to Dashboard where Sparklines are shown
    await page.goto('/dashboard');
    
    // Verify Sparkline is visible in a card
    // The Dashboard loads plants first, then measurements.
    const sparkline = page.locator('svg[role="img"][aria-label="sparkline"]').first();
    await expect(sparkline).toBeVisible({ timeout: 10000 });

    // Verify SVG path exists and has some data
    const path = sparkline.locator('path[fill="none"]');
    await expect(path).toHaveAttribute('d', /M/);

    // Test tooltips with extreme values
    const box = await sparkline.boundingBox();
    if (box) {
      // Hover in the middle
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Tooltip contains "g" (for grams)
      await expect(page.locator('div').filter({ hasText: /g/ }).last()).toBeVisible();
    }
  });

  test('SVG scaling logic doesn\'t result in broken paths for empty or flat data', async ({ page }) => {
    // 1. Flat data - start with this to avoid reload
    const flatData = [
        { id: 1, measured_at: '2026-01-01 10:00:00', measured_weight_g: 500 },
        { id: 2, measured_at: '2026-01-02 10:00:00', measured_weight_g: 500 }
    ];
    await page.route('**/api/plants/*/measurements', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(flatData),
        });
    });
    await page.goto('/dashboard');
    
    const sparkline = page.locator('svg[role="img"][aria-label="sparkline"]').first();
    await expect(sparkline).toBeVisible();
    const path = sparkline.locator('path[fill="none"]');
    await expect(path).toHaveAttribute('d', /M.*L/);

    // 2. Empty data
    await page.route('**/api/plants/*/measurements', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
    // Just re-trigger the load by navigating or clicking if possible, but dashboard might need reload to re-fetch
    await page.goto('/dashboard'); 
    
    // Cards with "Not enough data to chart" should be shown instead of Sparkline
    await expect(page.getByText(/not enough data to chart/i).first()).toBeVisible();
  });
});
