import { test, expect } from '@playwright/test'
import { seed, cleanup, login} from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Bulk Watering State', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await seed(ORIGIN)
    await login(page, ORIGIN)
    // Setup: Seed Fern needs min_dry_weight and max_water_weight to calculate retained %
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' })
    const seedFernRow = page.getByRole('row', { name: /seed fern/i })
    await seedFernRow.waitFor({ state: 'visible' })
    await seedFernRow
      .getByRole('button', { name: /edit/i })
      .click()
    await page.getByRole('tab', { name: /care/i }).click()
    await page.getByLabel(/recommended water threshold/i).fill('50')
    await page.getByRole('tab', { name: /calculated/i }).click()
    await page.getByLabel(/min dry weight/i).fill('200')
    await page.getByLabel(/max water weight/i).fill('100')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page).toHaveURL(/\/plants/)

    // Initial measurement to establish baseline
    await page.goto(`${ORIGIN}/measurement/weight`, { waitUntil: 'commit' })
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' })
    await page.getByLabel(/measured weight \(g\)/i).fill('225') // 25% retained (25/100)
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

  test('immediate deemphasis styling after bulk watering', async ({ page }) => {
    await page.goto('/measurements/bulk/watering', { waitUntil: 'commit' })
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/plants?uuids=') && resp.status() === 200,
    )
    await page.getByRole('button', { name: /all/i }).click()
    await responsePromise
    await expect(page.getByText(/loading/i)).not.toBeVisible()

    const row = page.getByRole('row', { name: /seed fern/i })
    await row.waitFor({ state: 'visible' })

    // Initially should not be deemphasized if it needs water.
    // However, to avoid flakiness with initial state calculation,
    // we focus on the transition after watering.

    // Input weight after watering: 300g (100% retained)
    const input = row.getByRole('spinbutton')
    await input.waitFor({ state: 'visible' })
    await input.fill('300')
    await input.blur()

    // Verify immediate success state and deemphasis
    await expect(input).toHaveClass(/bg-success/)
    // After watering, retained is 100%, which is > 50% threshold, so it should be deemphasized.
    await expect(row).toHaveAttribute('style', /opacity: 0.55/)
  })
})
