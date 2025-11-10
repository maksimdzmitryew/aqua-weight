import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';
import path from 'path';

const ORIGIN = process.env.E2E_BASE_URL || 'http://localhost:5173';

function fixture(p: string) {
  return path.resolve(__dirname, 'fixtures', p);
}

test.describe('Bulk weight measurement', () => {
  test.beforeEach(async () => { await seed(ORIGIN); });
  test.afterEach(async () => { await cleanup(ORIGIN); });

  test('success path', async ({ page }) => {
    await page.goto('/measurements/bulk/weight');
    // Fill the first weight input and blur to trigger save
    const firstInput = page.locator('table input[type="number"]').first();
    await firstInput.fill('321');
    await firstInput.blur();
    await expect(firstInput).toHaveClass(/bg-success/);
  });

  test('failure path shows errors', async ({ page }) => {
    await page.goto('/measurements/bulk/weight');
    const firstInput = page.locator('table input[type="number"]').first();
    // Enter an invalid negative weight; should show error styling after save attempt
    await firstInput.fill('-5');
    await firstInput.blur();
    await expect(firstInput).toHaveClass(/bg-error/);
  });
});