import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Localization Persistence beyond Date Formats', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('numerical decimal separators consistency placeholder', async ({ page }) => {
    await page.goto('/settings');
    // Currently the app only has date format localization.
    // The task asks to "Verify if numerical decimal separators (comma vs. dot) are handled consistently 
    // across forms if localization settings are expanded in the future."
    // Since it's not implemented yet, I will verify that the current default (dot) works 
    // and that the settings page remains stable.
    
    await expect(page.getByLabel(/date\/time format/i)).toBeVisible();
    
    // Check a form that uses numeric input, e.g., Plant Create
    await page.goto('/plants/new');
    
    // In PlantCreate.jsx, "Min Dry Weight" is in the "Calculated" tab
    await page.getByRole('tab', { name: /calculated/i }).click();
    
    const weightInput = page.getByLabel(/min dry weight/i);
    await weightInput.fill('10.5');
    await expect(weightInput).toHaveValue('10.5');
    
    // If we were to support commas in the future, we'd test it here.
    // For now, ensuring that standard numeric input works is our baseline.
  });
});
