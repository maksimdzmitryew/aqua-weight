import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Specialized Creations', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('repotting: create and verify in plant details', async ({ page }) => {
    await page.goto('/measurement/weight', { waitUntil: 'commit' });
    // 1. Create a base weight measurement because backend requires a previous event for repotting
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' });
    await page.getByLabel(/measured weight \(g\)/i).fill('350');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    // 2. Perform repotting
    await page.goto('/measurement/repotting', { waitUntil: 'commit' });
    await expect(page.getByText('Repotting', { exact: true })).toBeVisible();

    const plantSelect = page.getByLabel(/plant/i);
    await plantSelect.selectOption({ label: 'Seed Fern' });
    
    await page.getByLabel(/weight before repotting/i).fill('300');
    await page.getByLabel(/weight after repotting/i).fill('450');
    
    await page.getByRole('button', { name: /save repotting/i }).click();

    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: 'Seed Fern' })).toBeVisible();
    
    const historyTable = page.locator('table').last();
    await expect(historyTable.getByRole('row')).toHaveCount(5, { timeout: 10000 });
    await expect(historyTable.getByRole('cell', { name: '450' }).first()).toBeVisible();
  });

  test('single watering: create and verify in plant details', async ({ page }) => {
    // Use Seed Ivy to avoid conflict with Seed Fern from previous test
    await page.goto('/measurement/weight', { waitUntil: 'commit' });
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Ivy' });
    await page.getByLabel(/measured weight \(g\)/i).fill('350');
    await page.getByRole('button', { name: /save measurement/i }).click();
    await expect(page).not.toHaveURL(/\/measurement\/weight/);

    // 2. Perform watering
    await page.goto('/measurement/watering', { waitUntil: 'commit' });
    await expect(page.getByText('Watering', { exact: true })).toBeVisible();

    const plantSelect = page.getByLabel(/plant/i);
    await plantSelect.selectOption({ label: 'Seed Ivy' });
    
    await page.getByLabel(/current weight/i).fill('600');
    
    await page.getByRole('button', { name: /save watering/i }).click();

    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}/);
    await expect(page.getByRole('heading', { name: 'Seed Ivy' })).toBeVisible();
    
    const historyTable = page.locator('table').last();
    await expect(historyTable.getByRole('row')).toHaveCount(3, { timeout: 10000 });
    await expect(historyTable.getByRole('cell', { name: '600' }).first()).toBeVisible();
  });
});
