import { test, expect } from '@playwright/test'
import { seed, cleanup, login } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Bulk Watering', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await seed(ORIGIN)
    await login(page, ORIGIN)

    // Setup: Seed Fern needs water (min_dry=200, max_water=100, threshold=50)
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' })
    const seedFernRow = page.locator('tr').filter({ hasText: /seed fern/i })
    await seedFernRow.waitFor({ state: 'visible', timeout: 30000 })
    await seedFernRow.getByRole('button', { name: /edit/i }).click()
    await page.getByRole('tab', { name: /care/i }).click()
    await page.getByLabel(/recommended water threshold/i).fill('50')
    await page.getByRole('tab', { name: /calculated/i }).click()
    await page.getByLabel(/min dry weight/i).fill('200')
    await page.getByLabel(/max water weight/i).fill('100')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page).toHaveURL(/\/plants/)

    // Initial weight measurement to establish baseline (225g = 25% retained, below 50% threshold)
    await page.goto(`${ORIGIN}/measurement/weight`, { waitUntil: 'commit' })
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' })
    await page.getByLabel(/measured weight \(g\)/i).fill('225')
    await page.getByRole('button', { name: /save measurement/i }).click()
    await expect(page).not.toHaveURL(/\/measurement\/weight/)

    await page.close()
  })
  test.beforeEach(async ({ page }) => {
    await login(page, ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('watering flow: filter, input value, and verify success', async ({ page }) => {
    await page.goto('/measurements/bulk/watering', { waitUntil: 'commit' })
    await expect(page.getByRole('heading', { name: /bulk watering/i })).toBeVisible()

    // Switch to "All" tab to see all plants
    const allTab = page.getByRole('button', { name: /all/i })
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/plants?uuids=') && resp.status() === 200,
    )
    await allTab.click()
    await responsePromise
    await expect(page.getByText(/loading/i)).not.toBeVisible()
    await page.waitForLoadState('networkidle')

    // Find the row for "Seed Fern" by looking for the name in the Name column (3rd column)
    const rowWithFernName = page.locator('tr').filter({ hasText: /seed fern/i })
    await expect(rowWithFernName).toBeVisible({ timeout: 30000 })

    // Get the number input from the first column of this row using a more explicit approach
    // First, get all cells in the row, then get the input from the first cell
    const cells = await rowWithFernName.locator('td').all()
    expect(cells.length).toBeGreaterThan(0)
    const firstCell = cells[0]
    const input = firstCell.locator('input[type="number"]')
    await input.waitFor({ state: 'visible' })

    // Watering: enter new wet weight (300g - saturated capacity for this plant)
    await input.fill('300')
    await input.blur()

    // Wait for the API call to complete
    await page
      .waitForResponse((resp) => resp.url().includes('/plants/') && resp.status() === 200, {
        timeout: 15000,
      })
      .catch(() => {}) // Ignore timeout if no API call

    // Verify "Success" status/styling
    // The class 'bg-success' is added on success
    await expect(input).toHaveClass(/bg-success/, { timeout: 15000 })

    // Verification of updated state - input value should be 300
    await expect(input).toHaveValue('300')
  })
})
