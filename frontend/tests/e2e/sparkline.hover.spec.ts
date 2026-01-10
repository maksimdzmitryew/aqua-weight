import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Sparkline Hover', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN);
    // 1. Create multiple measurements to have a trend and delta
    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('300');
    await page.getByLabel(/measured at/i).fill('2025-01-01T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    await page.goto('/measurement/weight');
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('280');
    await page.getByLabel(/measured at/i).fill('2025-01-02T10:00');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);
  });

  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('hovering displays tooltip with correct date and delta', async ({ page }) => {
    await page.goto('/dashboard');
    const sparkline = page.locator('svg').first();
    await expect(sparkline).toBeVisible();

    // Move mouse to the right side of the sparkline to hit the latest point
    const box = await sparkline.boundingBox();
    if (!box) throw new Error('No bounding box');
    
    // Hover over the second point (right side)
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);

    // Verify HTML tooltip visibility
    // The tooltip is a div inside the Sparkline container but outside the SVG
    const tooltip = page.locator('div').filter({ hasText: /g/ }).filter({ hasText: /Δ/ }).first();
    await expect(tooltip).toBeVisible();

    // Verify content: 02/01/2025 (Europe default), 280 g, Δ -20 g
    await expect(tooltip).toContainText('02/01/2025');
    await expect(tooltip).toContainText('280 g');
    await expect(tooltip).toContainText('Δ -20 g');

    // Verify USA format if we change settings
    await page.goto('/settings');
    await page.getByLabel(/date\/time format/i).selectOption('usa');
    await page.getByRole('button', { name: /save/i }).click();

    await page.goto('/dashboard');
    const sparkline2 = page.locator('svg').first();
    const box2 = await sparkline2.boundingBox();
    if (!box2) throw new Error('No bounding box');
    await page.mouse.move(box2.x + box2.width - 5, box2.y + box2.height / 2);

    const tooltip2 = page.locator('div').filter({ hasText: /g/ }).filter({ hasText: /Δ/ }).first();
    await expect(tooltip2).toBeVisible();
    await expect(tooltip2).toContainText('01/02/2025'); // MM/DD/YYYY
  });
});
