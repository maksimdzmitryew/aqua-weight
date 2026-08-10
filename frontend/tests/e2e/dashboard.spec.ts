import { test, expect } from '@playwright/test'
import { seed, cleanup, login, createApiClient } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const SEED_FERN_ID = '22222222222222222222222222222222'

test.describe('Dashboard Controls', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN)
  })

  test.beforeEach(async ({ page }) => {
    await login(page, ORIGIN)
    await page.goto('/dashboard', { waitUntil: 'commit' })
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('reference line toggles update sparkline', async ({ page }) => {
    const api = await createApiClient(ORIGIN)
    try {
      const loginRes = await api.post('/api/test/login')
      expect(loginRes.ok()).toBeTruthy()
      const { access_token } = await loginRes.json()
      const headers = {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      }

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

      const watering = await api.post(`/api/plants/${SEED_FERN_ID}/measurements/watering`, {
        headers,
        data: {
          measured_at: '2025-01-03T10:00',
          last_dry_weight_g: 280,
          last_wet_weight_g: 500,
          water_added_g: 220,
        },
      })
      expect(watering.ok()).toBeTruthy()
    } finally {
      await api.dispose()
    }

    // Go to Dashboard and verify sparkline
    await page.goto('/dashboard', { waitUntil: 'commit' })
    // Ensure measurements are loaded before asserting sparkline visibility
    await page.waitForResponse(
      (res) => /\/api\/plants\/.+\/measurements/.test(res.url()) && res.status() === 200,
    )
    const sparkline = page.locator('svg[role="img"][aria-label="sparkline"]').first()
    await expect(sparkline).toBeVisible({ timeout: 20000 })

    const countRefLines = async () => {
      return await sparkline.locator('line[stroke-dasharray="4 3"]').count()
    }

    // We should have at least Dry and Max
    await expect(async () => {
      expect(await countRefLines()).toBeGreaterThan(0)
    }).toPass()
    const initialCount = await countRefLines()

    // Toggle "Show min dry weight"
    await page.getByLabel(/show min dry weight/i).uncheck()
    await expect(async () => {
      expect(await countRefLines()).toBe(initialCount - 1)
    }).toPass()

    // Toggle "Show max water weight"
    await page.getByLabel(/show max water weight/i).uncheck()
    await expect(async () => {
      expect(await countRefLines()).toBe(initialCount - 2)
    }).toPass()
  })

  test('grid layout selector updates grid layout', async ({ page }) => {
    // 1. charts per row selector updates grid layout
    const grid = page.locator('.main > div').last() // The grid container

    // Change to 1 chart per row
    await page.getByLabel(/charts per row/i).selectOption('1')
    await expect(grid).toHaveCSS('display', 'grid')
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(1,/)

    // Change to 3 charts per row
    await page.getByLabel(/charts per row/i).selectOption('3')
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(3,/)

    // Persistence check
    await page.reload({ waitUntil: 'commit' })
    await expect(page.getByLabel(/charts per row/i)).toHaveValue('3')
    await expect(grid).toHaveAttribute('style', /grid-template-columns: repeat\(3,/)
  })

  test('clicking plant card navigates to stats page', async ({ page }) => {
    await page
      .getByText(/seed fern/i)
      .first()
      .click()
    await expect(page).toHaveURL(/\/stats\/[a-f0-9-]{32,36}/)
    await expect(page.getByRole('heading', { name: /seed fern/i })).toBeVisible()
  })
})
