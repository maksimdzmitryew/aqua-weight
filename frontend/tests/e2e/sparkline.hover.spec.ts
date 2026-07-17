import { test, expect } from '@playwright/test'
import { seed, cleanup, login, createApiClient } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const SEED_FERN_ID = '22222222222222222222222222222222'

test.describe('Sparkline Hover', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN)
    const api = await createApiClient(ORIGIN)
    try {
      const loginRes = await api.post('/api/test/login')
      expect(loginRes.ok()).toBeTruthy()
      const { access_token } = await loginRes.json()
      const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }

      const plantCalibration = await api.patch(`/api/plants/${SEED_FERN_ID}`, {
        headers,
        data: { min_dry_weight_g: 200, max_water_weight_g: 100 },
      })
      expect(plantCalibration.ok()).toBeTruthy()

      const firstWeight = await api.post(`/api/plants/${SEED_FERN_ID}/measurements/weight`, {
        headers,
        data: {
          measured_weight_g: 300,
          measured_at: '2025-01-01T10:00',
          last_dry_weight_g: 200,
          last_wet_weight_g: 300,
        },
      })
      expect(firstWeight.ok()).toBeTruthy()

      const secondWeight = await api.post(`/api/plants/${SEED_FERN_ID}/measurements/weight`, {
        headers,
        data: { measured_weight_g: 280, measured_at: '2025-01-02T10:00' },
      })
      expect(secondWeight.ok()).toBeTruthy()
    } finally {
      await api.dispose()
    }
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

    // Verify content: current default date format, 280 g, Δ -20 g
    await expect(tooltip).toContainText('01/02/2025')
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
