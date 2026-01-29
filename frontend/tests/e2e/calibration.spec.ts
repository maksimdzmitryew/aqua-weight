import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Calibration', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN);
  });
  test.afterAll(async () => {
    await cleanup(ORIGIN);
  });

  test('filters and basic view', async ({ page }) => {
    await page.goto('/calibration', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: /calibration/i })).toBeVisible();

    // With minimal seed, there might not be any calibration entries yet
    // since calibration entries are derived from watering events that don't reach 100%.
    // If no entries, it shows "No plants found" or EmptyState.
    // Based on the code: items.length === 0 -> EmptyState
    
    // Let's check if "Seed Fern" is visible. If it's a new plant, it has no watering events.
    // But the list should still show all plants that have potential for calibration?
    // Actually the API /api/calibration likely only returns plants with calibration data.
    
    // If EmptyState is visible:
    if (await page.getByText(/No plants found/i).isVisible()) {
       await expect(page.getByText(/Create a plant to start calibrating/i)).toBeVisible();
    } else {
       // If plants are visible, test filters
       const underwateredCheckbox = page.getByLabel(/underwatered/i);
       await underwateredCheckbox.check();
       await expect(underwateredCheckbox).toBeChecked();
       
       const nonZeroCheckbox = page.getByLabel(/zero Below Max Water, all/i);
       await nonZeroCheckbox.check();
       await expect(nonZeroCheckbox).toBeChecked();
    }
  });
});
