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
    await page.goto('/plants', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();

    // Create Plant
    await page.getByRole('button', { name: /\+\s*Create/i }).click();
    await page.getByLabel(/name/i).fill('Test Fern');
    // Wait for locations to load and then select by label to avoid hard-coded UUIDs
    const locationSelect = page.getByLabel(/location/i);
    await expect(locationSelect).toBeEnabled();
    // Poll the DOM until a non-placeholder option is available
    await expect(async () => {
      const values = await locationSelect.locator('option').evaluateAll((opts) => opts.map(o => (o as HTMLOptionElement).value));
      // Expect at least one non-empty option besides the placeholder
      expect(values.filter(v => v).length).toBeGreaterThan(0);
    }).toPass();
    // Once options are loaded, assert and select by label
    await expect(async () => {
      const options = await locationSelect.locator('option').allTextContents();
      expect(options.join(' ')).toMatch(/living room/i);
    }).toPass();
    await locationSelect.selectOption({ label: 'Living Room' });
    await page.getByRole('button', { name: /save/i }).click();

    // List shows new plant
    await expect(page.getByRole('row', { name: /test fern/i })).toBeVisible();

    // Edit
    await page.getByRole('row', { name: /test fern/i }).getByRole('button', { name: /edit/i }).click();
    await expect(page.getByLabel(/name/i)).toBeDisabled();
    await page.getByLabel(/description/i).fill('Updated description');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('row', { name: /test fern/i })).toBeVisible();

    // Delete
    await page.getByRole('row', { name: /test fern/i }).getByRole('button', { name: /delete/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('row', { name: /test fern/i })).toHaveCount(0);
  });

  test('updated column uses most recent of plant update and measurement date', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dtFormat', 'europe');
    });

    const saveMeasurement = async (plantName: string, weight: string, measuredAt: string) => {
      await page.goto('/measurement/weight', { waitUntil: 'commit' });
      const plantSelect = page.getByLabel(/plant/i);
      await expect(plantSelect).toBeEnabled();
      await expect(async () => {
        const options = await plantSelect.locator('option').allTextContents();
        expect(options.join(' ')).toMatch(new RegExp(plantName, 'i'));
      }).toPass();
      await plantSelect.selectOption({ label: plantName });
      await page.getByLabel(/measured weight/i).fill(weight);
      await page.getByLabel(/measured at/i).fill(measuredAt);
      const saveButton = page.getByRole('button', { name: /save measurement/i });
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await page.waitForURL(/\/plants\/[a-f0-9-]{32,36}/);
    };

    await saveMeasurement('Seed Fern', '123', '2030-01-02T10:00');
    await saveMeasurement('Seed Ivy', '120', '2024-01-02T10:00');

    await page.goto('/plants', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();

    const fernRow = page.getByRole('row', { name: /seed fern/i });
    const fernUpdatedTitle = await fernRow.locator('td').nth(7).locator('span').getAttribute('title');
    expect(fernUpdatedTitle || '').toContain('2030-01-02');

    const ivyRow = page.getByRole('row', { name: /seed ivy/i });
    const ivyUpdatedTitle = await ivyRow.locator('td').nth(7).locator('span').getAttribute('title');
    expect(ivyUpdatedTitle || '').not.toContain('2024-01-02');
  });
});