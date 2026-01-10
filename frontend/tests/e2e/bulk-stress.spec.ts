import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Data Integrity during Rapid Input', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN);
  });

  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('rapid input in bulk weight maps correctly to rows even with slow API', async ({ page }) => {
    await page.goto('/measurements/bulk/weight');
    
    // Wait for at least 2 plants to be loaded
    const inputs = page.locator('table input[type="number"]');
    await expect(inputs).toHaveCount(2);

    // Mock API to be slow and potentially return out of order
    let requestCount = 0;
    await page.route('**/api/measurements/weight', async route => {
      requestCount++;
      const currentRequest = requestCount;
      // Delay second request more than first to simulate out-of-order response
      const delay = currentRequest === 1 ? 1000 : 100;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const plantId = route.request().postDataJSON()?.plant_id;
      
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ 
          status: 'success', 
          data: { 
            id: currentRequest,
            plant_id: plantId,
            water_loss_total_pct: 10 * currentRequest,
            water_retained_pct: 90 - (10 * currentRequest)
          } 
        }),
      });
    });

    // Rapidly fill two different rows
    const firstInput = inputs.nth(0);
    const secondInput = inputs.nth(1);

    await firstInput.fill('100');
    await firstInput.blur(); // Triggers first request (delayed 500ms)

    await secondInput.fill('200');
    await secondInput.blur(); // Triggers second request (delayed 100ms)

    // Wait for both to show success
    await expect(firstInput).toHaveClass(/bg-success/);
    await expect(secondInput).toHaveClass(/bg-success/);

    // Check if the data is correctly mapped to the rows
    // Second input should finish first due to shorter delay
    // We want to ensure the second request's response doesn't accidentally overwrite first row's status or data
    
    // The plant names or IDs should be stable.
    const rows = page.locator('table tbody tr');
    
    // Check first row's water retained % - should eventually reflect its own response
    // Actually BulkWeightMeasurement.jsx updates the plants state.
    // First request (currentRequest=1) returns water_retained_pct: 80
    // Second request (currentRequest=2) returns water_retained_pct: 70
    
    await expect(rows.nth(0)).toContainText('80%');
    await expect(rows.nth(1)).toContainText('70%');
  });
});
