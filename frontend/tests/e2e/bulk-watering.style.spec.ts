import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Bulk Watering Styles', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await seed(ORIGIN)

    // Plant 1: Thirsty (Seed Fern)
    // ID from seed: 22222222222222222222222222222222
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('row', { name: /seed fern/i })
      .getByRole('button', { name: /edit/i })
      .click()
    await page.getByRole('tab', { name: /care/i }).click()
    await page.getByLabel(/recommended water threshold/i).fill('50')
    await page.getByRole('tab', { name: /calculated/i }).click()
    await page.getByLabel(/min dry weight/i).fill('200')
    await page.getByLabel(/max water weight/i).fill('100')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page).toHaveURL(/\/plants/)

    await page.goto(`${ORIGIN}/measurement/watering?plant=22222222222222222222222222222222`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel(/current weight/i).fill('225') // 25% < 50%
    await page.getByRole('button', { name: /save watering/i }).click()
    await expect(page).not.toHaveURL(/\/measurement\/watering/)

    // Plant 2: Satisfied (Seed Ivy)
    // ID from seed: 33333333333333333333333333333333
    await page.goto(`${ORIGIN}/plants`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('row', { name: /seed ivy/i })
      .getByRole('button', { name: /edit/i })
      .click()
    await page.getByRole('tab', { name: /care/i }).click()
    await page.getByLabel(/recommended water threshold/i).fill('20')
    await page.getByRole('tab', { name: /calculated/i }).click()
    await page.getByLabel(/min dry weight/i).fill('200')
    await page.getByLabel(/max water weight/i).fill('100')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page).toHaveURL(/\/plants/)

    await page.goto(`${ORIGIN}/measurement/weight?plant=33333333333333333333333333333333`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel(/measured weight/i).fill('280') // 80% > 20%
    await page.getByRole('button', { name: /save measurement/i }).click()
    await expect(page).not.toHaveURL(/\/measurement\/weight/)
    await page.close()
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('conditional styling in bulk watering show all mode', async ({ page }) => {
    // Navigate and show all
    await page.goto(`${ORIGIN}/measurements/bulk/watering`)
    await page.waitForLoadState('networkidle')
    
    // Toggle "Show All"
    await page.getByRole('button', { name: /all/i }).click()

    // Find the row for Seed Ivy (which is satisfied)
    const satisfiedRow = page.locator('tr').filter({ hasText: /seed ivy/i })
    
    // Ensure the row is visible
    await expect(satisfiedRow).toBeVisible()

    // The core of the issue: opacity: 0.55 should be applied to satisfied rows in "Show All" mode
    // We verify this by checking the computed style of the <tr> element.
    const opacity = await satisfiedRow.evaluate((el) => window.getComputedStyle(el).opacity)
    expect(Number(opacity)).toBeCloseTo(0.55, 1)
  })
})
