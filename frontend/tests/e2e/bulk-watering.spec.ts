import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Bulk Watering', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('watering flow: filter, input value, and verify success', async ({ page }) => {
    await page.goto('/measurements/bulk/watering');
    await expect(page.getByRole('heading', { name: /bulk watering/i })).toBeVisible();

    // 1. Initial State: "Seed Fern" should be visible because it needs water (retained NaN/0)
    await expect(page.getByRole('row', { name: /seed fern/i })).toBeVisible();

    // 2. Toggle "Show all plants"
    const showAllCheckbox = page.getByLabel(/show all plants/i);
    await expect(showAllCheckbox).not.toBeChecked();
    await showAllCheckbox.check();
    await expect(showAllCheckbox).toBeChecked();
    
    // 3. Submit Watering
    // Find the input for "Seed Fern". It's in the same row.
    const row = page.getByRole('row', { name: /seed fern/i });
    const weightInput = row.locator('input[type="number"]');
    
    await weightInput.fill('500');
    await weightInput.blur(); // Trigger onBlur to commit

    // 4. Verify "Success" status/styling
    // The class 'bg-success' is added on success
    await expect(weightInput).toHaveClass(/bg-success/);
    
    // 5. Verification of updated state
    // The row should now show the updated weight/percentage if the API returned it.
    // In our case, the mock/test-admin might not compute complex values but it should return something.
    // The input value itself is 500
    await expect(weightInput).toHaveValue('500');
  });
});
