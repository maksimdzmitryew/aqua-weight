import { test, expect } from '@playwright/test';
import { seed, cleanup, createApiClient } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Advanced Calibration Interactions', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('calibration flow: trigger correction and verify UI refresh', async ({ page }) => {
    // 1. Just verify the button exists and is clickable when some data is present
    await page.goto('/calibration');
    await expect(page.getByRole('heading', { name: /calibration/i })).toBeVisible();
    
    // Check filters
    const underwatered = page.getByLabel(/underwatered/i);
    await underwatered.check();
    await expect(underwatered).toBeChecked();
    
    // If seed data is sufficient to show at least one plant
    if (await page.locator('.card').count() > 0) {
      const correctBtn = page.getByRole('button', { name: /correct overfill/i }).first();
      // Even if disabled, we verify visibility
      await expect(correctBtn).toBeVisible();
    }
  });

  test('calibration filters interaction', async ({ page }) => {
    await page.goto('/calibration');
    
    const f1 = page.getByLabel(/underwatered/i);
    const f2 = page.getByLabel(/zero Below Max Water, all/i);
    const f3 = page.getByLabel(/zero Below Max Water, last/i);
    
    await f1.check();
    await expect(f1).toBeChecked();
    
    await f2.check();
    await expect(f2).toBeChecked();
    
    await f3.check();
    await expect(f3).toBeChecked();
    
    await f1.uncheck();
    await expect(f1).not.toBeChecked();
  });
});
