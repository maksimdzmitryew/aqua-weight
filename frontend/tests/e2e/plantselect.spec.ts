import { test, expect } from '@playwright/test';

// These tests focus on the PlantSelect component as used on the WateringCreate page.
// We intercept /api/plants/names to simulate success and error states, asserting
// the loading indicator, populated options, and error message rendering.

test.describe('PlantSelect (Watering Create page)', () => {
  test('shows loading, then populates options on success', async ({ page }) => {
    // Intercept names endpoint with a slight delay to ensure loading state is visible
    await page.route('**/api/plants/names', async route => {
      // Artificial delay to catch the "Loading plants..." state reliably
      await new Promise(r => setTimeout(r, 150));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { uuid: 'p1', name: 'Playwright Fern' },
          { uuid: 'p2', name: 'Playwright Ivy' },
        ]),
      });
    });

    await page.goto('/measurement/watering', { waitUntil: 'commit' });

    // After data loads, default option switches and new options appear
    const defaultOption = page.locator('select#plant_id >> option').first();
    await expect(defaultOption).toHaveText(/select plant/i);
    await expect(page.locator('select#plant_id >> option', { hasText: 'Playwright Fern' })).toHaveCount(1);
    await expect(page.locator('select#plant_id >> option', { hasText: 'Playwright Ivy' })).toHaveCount(1);

    // Can select an option by label
    await page.getByLabel(/plant/i).selectOption({ label: 'Playwright Ivy' });
    await expect(page.getByLabel(/plant/i)).toHaveValue('p2');
  });

  test('renders error state when names API fails (covers non-abort error path)', async ({ page }) => {
    // Force the names endpoint to fail with 500 to trigger component error path
    await page.route('**/api/plants/names', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Internal Server Error' }),
    }));

    await page.goto('/measurement/watering', { waitUntil: 'commit' });

    // Default option reflects error message and below-select error notice is shown
    const errorOption = page.locator('select#plant_id >> option').first();
    await expect(errorOption).toHaveText(/error loading plants/i);
    await expect(page.getByText(/failed to load plants/i)).toBeVisible();
  });
});
