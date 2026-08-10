import { test, expect } from '@playwright/test'
import { seed, cleanup, login } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.beforeAll(async () => {
  await seed(ORIGIN)
})
test.afterAll(async () => {
  await cleanup(ORIGIN)
})

test('UC1: overwater warning modal appears from Plant Details watering button', async ({
  page,
}) => {
  await login(page, ORIGIN)

  // Get a token for direct API calls
  const loginRes = await page.request.post('/api/test/login')
  const { access_token } = await loginRes.json()
  const auth = { Authorization: `Bearer ${access_token}` }

  // Pick a plant and set capacity so UC1 should trigger
  const list = await page.request.get('/api/plants?limit=5', { headers: auth })
  const plants = (await list.json()).items as any[]
  const uuid = plants[0].uuid
  await page.request.patch(`/api/plants/${uuid}`, {
    headers: auth,
    data: { min_dry_weight_g: 100, max_water_weight_g: 50 },
  })

  // Go to plant details
  await page.goto(`/plants/${uuid}`)
  await expect(page.getByText(/minimum weight/i)).toBeVisible()

  // Click the Watering quick button
  await page.getByLabel(/watering for/i).click()
  await expect(page).toHaveURL(/\/measurement\/watering/)

  // Enter an over-capacity wet weight (200 > 100 + 50)
  await page.getByLabel(/current weight/i).fill('200')
  await page.getByRole('button', { name: /save watering/i }).click()

  // The root rot warning must appear
  await expect(page.getByText(/risk of root rot warning/i)).toBeVisible({ timeout: 5000 })
})
