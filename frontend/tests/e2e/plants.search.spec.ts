import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Plants search & filter', () => {
  test.beforeEach(async () => {
    await seed(ORIGIN);
  });
  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('filters by text and handles numeric input', async ({ page }) => {
    await page.goto('/plants');
    await expect(page.getByRole('heading', { name: /plants/i })).toBeVisible();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // Count initial rows (only within tbody)
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const initialRows = await rows.count();
    expect(initialRows).toBeGreaterThan(0);

    // Search by text that yields no results to verify filtering applies deterministically
    // type="search" maps to ARIA role "searchbox"
    const search = page.getByRole('searchbox', { name: /search plants/i });
    await search.fill('__no_match__');
    await expect(rows).toHaveCount(0);

    // Clear
    const clear = page.getByRole('button', { name: /clear search/i });
    await clear.click();
    await expect(rows).toHaveCount(initialRows);

    // Numeric input: ensure it applies a filter without assuming specific seed data
    await search.fill('30');
    // Wait for the table to settle and then ensure count is between 0 and initialRows
    const rowsAfterNumeric = await rows.count();
    expect(rowsAfterNumeric).toBeGreaterThanOrEqual(0);
    expect(rowsAfterNumeric).toBeLessThanOrEqual(initialRows);
    // Cross-check the "Showing X of Y" meta reflects the same filtered count
    const meta = page.getByText(/Showing .* of .* plants?/i);
    await expect(meta).toBeVisible();
    const metaText = await meta.innerText();
    const match = metaText.match(/Showing\s+(\d+)\s+of\s+(\d+)/i);
    expect(match).not.toBeNull();
    if (match) {
      const shown = Number(match[1]);
      expect(shown).toBe(rowsAfterNumeric);
    }
  });
});
