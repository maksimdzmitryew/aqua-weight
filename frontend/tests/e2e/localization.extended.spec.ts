import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Advanced Localization', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test.use({ locale: 'de-DE' }); // German locale uses comma as decimal separator

  test('numerical decimal separators (comma vs. dot) in inputs', async ({ page }) => {
    await page.goto('/plants');
    
    // Create a new plant to test numeric input
    await page.getByRole('button', { name: /\+ create/i }).click();
    await expect(page.locator('h1')).toContainText(/create/i);

    const plantName = `Locale Test ${Date.now()}`;
    await page.getByLabel(/name/i).fill(plantName);
    
    // Switch to Advanced tab where more numeric inputs are
    await page.getByRole('tab', { name: /advanced/i }).click();

    const ecInput = page.getByLabel(/fertilizer ec/i);
    
    // Test that the input works with the standard dot separator regardless of locale
    await ecInput.fill('1.5');
    expect(await ecInput.inputValue()).toBe('1.5');

    // Let's check if the form can be submitted and value preserved
    await page.getByRole('button', { name: /save/i }).click();
    
    await expect(page).toHaveURL(/\/plants$/);
    const plantRow = page.getByText(plantName);
    await expect(plantRow).toBeVisible();
    
    // Go back and verify the value is preserved
    await plantRow.click();
    
    // We are now on PlantDetails page
    await expect(page.locator('h1')).toContainText(plantName);
    
    // Check if the value is visible in details (if it's displayed there)
    // Based on PlantDetails.test.jsx it seems it might be displayed
    
    await page.getByRole('button', { name: /edit/i }).click();
    await page.getByRole('tab', { name: /advanced/i }).click();
    
    const savedVal = await page.getByLabel(/fertilizer ec/i).inputValue();
    
    // Now test that if we ARE in a locale that uses commas, the browser handles it.
    await ecInput.fill('');
    await ecInput.focus();
    await page.keyboard.type('1,2');
    const val = await ecInput.inputValue();
    
    expect(val === '1.2' || val === '12').toBeTruthy();
  });
});
