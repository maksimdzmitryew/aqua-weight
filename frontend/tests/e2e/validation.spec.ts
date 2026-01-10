import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Form Validation', () => {
  test.beforeEach(async () => {
    await seed(ORIGIN);
  });

  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('plant creation validation', async ({ page }) => {
    await page.goto(`${ORIGIN}/plants/new`);
    
    // Bypass browser validation to test application-level validation
    await page.locator('#name').evaluate(el => el.removeAttribute('required'));
    
    // Try to save without name
    await page.getByRole('button', { name: /save/i }).click();
    
    // Check for error message
    await expect(page.getByText(/name is required/i)).toBeVisible();
    
    // Fill name and save should work
    await page.getByLabel(/name/i).fill('Valid Plant');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/plants$/);
  });

  test('location creation validation', async ({ page }) => {
    await page.goto(`${ORIGIN}/locations/new`);
    
    await page.locator('#name').evaluate(el => el.removeAttribute('required'));
    
    // Try to save without name
    await page.getByRole('button', { name: /save/i }).click();
    
    // Check for error message
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });

  test('measurement form validation', async ({ page }) => {
    await page.goto(`${ORIGIN}/measurement/weight`);
    
    // The Select component for plant_id is usually a native select
    await page.getByLabel(/plant/i).evaluate(el => el.removeAttribute('required'));
    
    // Try to save without plant selected
    await page.getByRole('button', { name: /save measurement/i }).click();
    
    // Check for "Required" error
    // In useForm, it might be exactly "Required"
    await expect(page.getByText(/^Required$/i)).toBeVisible();
    
    // Enter invalid weight (negative)
    await page.getByLabel(/measured weight \(g\)/i).fill('-10');
    // Trigger validation via blur
    await page.getByLabel(/measured weight \(g\)/i).blur();
    
    // Check for "Must be >= 0" error
    await expect(page.getByText(/must be >= 0/i)).toBeVisible();
  });
});
