import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Plants CRUD', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('create plant → list shows plant → edit → delete', async ({ page }) => {
    // Go to plants list
    await page.goto('/plants');
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();

    // Create Plant
    await page.getByRole('button', { name: /\+\s*Create/i }).click();
    await page.getByLabel(/name/i).fill('Test Fern');
    // Wait for locations to load and the "Living Room" option to appear
    await page.getByLabel(/location/i).selectOption('11111111111111111111111111111111');
    await page.getByRole('button', { name: /save/i }).click();

    // List shows new plant
    await expect(page.getByRole('row', { name: /test fern/i })).toBeVisible();

    // Edit
    await page.getByRole('row', { name: /test fern/i }).getByRole('button', { name: /edit/i }).click();
    await page.getByLabel(/name/i).fill('Test Fern v2');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('row', { name: /test fern v2/i })).toBeVisible();

    // Delete
    await page.getByRole('row', { name: /test fern v2/i }).getByRole('button', { name: /delete/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('row', { name: /test fern v2/i })).toHaveCount(0);
  });
});