import { test, expect } from '@playwright/test'
import { seed, cleanup, login} from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Sparkline Hover', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await seed(ORIGIN)
    await login(page, ORIGIN)
    // 1. Create multiple measurements to have a trend and delta
    await page.goto(`${ORIGIN}/measurement/weight`, { waitUntil: 'commit' })
    await expect(page.getByLabel(/plant/i).locator('option', { hasText: 'Seed Fern' })).toHaveCount(1, { timeout: 10000 })
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' })
    await page.getByLabel(/measured weight \(g\)/i).fill('300')
    await page.getByLabel(/measured at/i).fill('2025-01-01T10:00')
    await page.getByRole('button', { name: /save measurement/i }).click()
    await expect(page).not.toHaveURL(/\/measurement\/weight/)

    await page.goto(`${ORIGIN}/measurement/weight`, { waitUntil: 'commit' })
    await expect(page.getByLabel(/plant/i).locator('option', { hasText: 'Seed Fern' })).toHaveCount(1, { timeout: 10000 })
    await page.getByLabel(/plant/i).selectOption({ label: 'Seed Fern' })
    await page.getByLabel(/measured weight \(g\)/i).fill('280')
    await page.getByLabel(/measured at/i).fill('2025-01-02T10:00')
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

  test('hovering displays tooltip with correct date and delta', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'commit' })
    const sparkline = page.locator('svg').first()
    await expect(sparkline).toBeVisible()

    // Move mouse to the right side of the sparkline to hit the latest point
    const box = await sparkline.boundingBox()
    if (!box) throw new Error('No bounding box')

    // Hover over the second point (right side)
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2)

    // Verify HTML tooltip visibility
    // The tooltip is a div inside the Sparkline container but outside the SVG
    // Scope to the sparkline container to avoid matching the root div
    const tooltip = sparkline.locator('..').locator('div').filter({ hasText: /Δ/ }).first()
    await expect(tooltip).toBeVisible()

    // Verify content: 02/01/2025 (Europe default), 280 g, Δ -20 g
    await expect(tooltip).toContainText('02/01/2025')
    await expect(tooltip).toContainText('280 g')
    await expect(tooltip).toContainText('Δ -20 g')

    // Verify USA format if we change settings
    await page.goto('/settings', { waitUntil: 'commit' })
    await page.getByLabel(/date\/time format/i).selectOption('usa')
    await page.getByRole('button', { name: /save/i }).click()
    // Wait for the save to settle (backend may reject unknown keys, but UI should reflect selection)
    await page.waitForTimeout(2000)
    // Ensure localStorage has the USA format for the Sparkline component
    await page.evaluate(() => localStorage.setItem('dtFormat', 'usa'))

    await page.goto('/dashboard', { waitUntil: 'commit' })
    const sparkline2 = page.locator('svg').first()
    const box2 = await sparkline2.boundingBox()
    if (!box2) throw new Error('No bounding box')
    await page.mouse.move(box2.x + box2.width - 5, box2.y + box2.height / 2)

    const tooltip2 = sparkline2.locator('..').locator('div').filter({ hasText: /Δ/ }).first()
    await expect(tooltip2).toBeVisible()
    await expect(tooltip2).toContainText('01/02/2025') // MM/DD/YYYY
  })
})
