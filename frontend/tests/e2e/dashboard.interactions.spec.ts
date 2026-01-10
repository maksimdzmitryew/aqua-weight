import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Advanced Dashboard Interactivity', () => {
  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('suggested watering interval toggle and persistence', async ({ page }) => {
    await seed(ORIGIN);
    await page.goto('/dashboard');
    
    const toggle = page.getByLabel(/show suggested watering interval/i);
    await expect(toggle).toBeChecked(); // Default should be checked

    // Uncheck and verify persistence
    await toggle.uncheck();
    await page.reload();
    await expect(toggle).not.toBeChecked();

    // Check again
    await toggle.check();
    await page.reload();
    await expect(toggle).toBeChecked();
  });

  test('empty state when no plants exist', async ({ page }) => {
    // Explicitly cleanup to ensure no plants
    await cleanup(ORIGIN);
    await page.goto('/dashboard');

    await expect(page.getByText(/no plants yet/i)).toBeVisible();
    
    // Check if there is a link or button to create a plant
    // Looking at Dashboard.jsx: <div>No plants yet. Create a plant to see its chart here.</div>
    // It doesn't seem to have a real link in the text, but let's see if we can improve it or just verify the text.
    await expect(page.getByText(/create a plant/i)).toBeVisible();
  });
});
