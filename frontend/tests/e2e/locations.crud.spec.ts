import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Locations Management', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('list locations, create, edit, and delete', async ({ page }) => {
    // 1. List Locations
    await page.goto('/locations');
    await expect(page.getByRole('heading', { name: /locations/i, exact: true })).toBeVisible();
    
    // Verify seeded locations are visible (assuming seed provides some)
    // Based on plants.crud.spec.ts, '11111111111111111111111111111111' is a location uuid.
    // Let's check for "Living Room" which is likely the name for that ID.
    await expect(page.getByRole('row')).toHaveCount(2); // Header + 1 seeded location (Living Room)

    // 2. Create Location
    await page.getByRole('button', { name: /\+\s*Create/i }).click();
    await expect(page).toHaveURL(/\/locations\/new/);
    await page.getByLabel(/name/i).fill('Balcony');
    await page.getByLabel(/description/i).fill('Sunny balcony');
    await page.getByRole('button', { name: /save/i }).click();

    // Verify it appears in the list
    await expect(page).toHaveURL(/\/locations/);
    await expect(page.getByRole('row', { name: /balcony/i })).toBeVisible();

    // 3. Edit Location
    await page.getByRole('row', { name: /balcony/i }).getByRole('button', { name: /edit/i }).click();
    await expect(page.getByLabel(/name/i)).toHaveValue('Balcony');
    await page.getByLabel(/name/i).fill('Greenhouse');
    await page.getByRole('button', { name: /save/i }).click();

    // Verify the update
    await expect(page).toHaveURL(/\/locations/);
    await expect(page.getByRole('row', { name: /greenhouse/i })).toBeVisible();
    // Use regex to avoid partial matches if necessary, though here we want it gone
    await expect(page.getByRole('row', { name: /^balcony/i })).toHaveCount(0);

    // 4. Delete Location
    await page.getByRole('row', { name: /greenhouse/i }).getByRole('button', { name: /delete/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /delete/i, exact: true }).click();

    // Verify deletion
    await expect(page.getByRole('row', { name: /greenhouse/i })).toHaveCount(0);
  });
});
