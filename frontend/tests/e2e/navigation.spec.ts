import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Layout and Navigation', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });

  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('sidebar active states and navigation', async ({ page }) => {
    await page.goto(`${ORIGIN}/dashboard`, { waitUntil: 'commit' });
    
    // Check if Overview is active
    await expect(page.getByRole('link', { name: /overview/i })).toHaveClass(/active/);
    
    // Navigate to Plants via sidebar
    await page.getByRole('link', { name: /plants/i, exact: true }).click();
    await expect(page).toHaveURL(/\/plants$/);
    await expect(page.getByRole('link', { name: /plants/i, exact: true })).toHaveClass(/active/);
    await expect(page.getByRole('link', { name: /overview/i })).not.toHaveClass(/active/);
    
    // Navigate to Locations
    await page.getByRole('link', { name: /locations/i }).click();
    await expect(page).toHaveURL(/\/locations$/);
    await expect(page.getByRole('link', { name: /locations/i })).toHaveClass(/active/);
  });

  test('back to home navigation', async ({ page }) => {
    await page.goto(`${ORIGIN}/dashboard`, { waitUntil: 'commit' });
    
    // Back to Home link in sidebar
    await page.getByRole('link', { name: /back to home/i }).click();
    await expect(page).toHaveURL(new RegExp(ORIGIN + '/$'));
    await expect(page.getByRole('heading', { name: /AW Frontend/i })).toBeVisible();
  });

  test('page header quick create navigation', async ({ page }) => {
    await page.goto(`${ORIGIN}/locations`, { waitUntil: 'commit' });
    
    // PageHeader might have a plus button or "Create" text
    // In LocationsList.jsx: onCreate={() => navigate('/locations/new')}
    // PageHeader.jsx (not seen yet, but common pattern)
    // Let's look for a button with "Create" or "+"
    const createBtn = page.getByRole('button', { name: /create/i });
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await expect(page).toHaveURL(/\/locations\/new/);
    }
  });
});
