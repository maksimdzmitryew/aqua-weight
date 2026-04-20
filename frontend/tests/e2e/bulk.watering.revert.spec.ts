import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Bulk Watering – delete reverts water loss (covers revert logic)', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('create watering, then delete and verify revert on list row', async ({ page }) => {
    // Go to Bulk Watering page
    await page.goto('/measurements/bulk/watering', { waitUntil: 'commit' })
    await expect(page.getByRole('heading', { name: /bulk watering/i })).toBeVisible()

    // By default, only plants that "need water" are shown. Our seed is minimal, so toggle "Show all plants".
    const showAllLabel = page.getByText('Show all plants')
    await expect(showAllLabel).toBeVisible()
    // Click the associated checkbox (wrapped in the label)
    await showAllLabel.click()

    // Find the seeded plant row (Seed Fern) and its input
    const row = page.getByRole('row', { name: /seed fern/i })
    await expect(row).toBeVisible()
    const weightInput = row.locator('input[type="number"]')
    await expect(weightInput).toBeVisible()

    // Enter a new weight and blur to commit watering (onBlur handler saves)
    await weightInput.fill('1234')
    // Blur by pressing Tab
    await weightInput.press('Tab')

    // After save, a delete button should appear for the measurement in this row
    const deleteBtn = row.getByRole('button', { name: 'Delete watering' })
    await expect(deleteBtn).toBeVisible()

    // The input should temporarily have success background
    await expect(weightInput).toHaveClass(/bg-success/)

    // Optionally capture water loss display after create (often 0%)
    // This is in the Water loss column rendered as a link with a % suffix
    const percentLink = row.getByRole('link').filter({ hasText: /%$/ })
    const afterCreatePct = await percentLink.first().textContent()

    // Now delete the watering
    await deleteBtn.click()

    // The delete button should disappear for this row
    await expect(row.getByRole('button', { name: 'Delete watering' })).toHaveCount(0)

    // The success class should be cleared after deletion
    await expect(weightInput).not.toHaveClass(/bg-success/)

    // And the percentage should change from the just-created value (e.g., '0%')
    const afterDeletePct = await percentLink
      .first()
      .textContent()
      .catch(() => null)
    if (afterCreatePct && afterDeletePct) {
      expect(afterDeletePct.trim()).not.toBe(afterCreatePct.trim())
    }
  })
})
