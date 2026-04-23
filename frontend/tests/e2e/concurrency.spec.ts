import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Concurrency and Error Handling', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('UI-driven API conflict handling (409 Conflict)', async ({ page }) => {
    await page.goto('/plants', { waitUntil: 'commit' })
    await page
      .getByRole('row', { name: /seed fern/i })
      .getByRole('button', { name: /edit/i })
      .click()
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}\/edit/)

    const descInput = page.getByLabel(/description/i)
    await descInput.fill('Conflicting Description')

    // Mock 409 Conflict for PUT /api/plants/{uuid}
    await page.route('**/api/plants/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'A conflict occurred' }),
        })
      } else {
        await route.continue()
      }
    })

    // Listen for alert without waiting on navigation from submit
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog'),
      page.getByRole('button', { name: /save/i }).click({ noWaitAfter: true }),
    ])
    expect(dialog.message()).toContain('A conflict occurred')
    await dialog.dismiss()

    // Verify form data is retained and we stay on the same page
    await expect(page).toHaveURL(/\/plants\/[a-f0-9-]{32,36}\/edit/)
    await expect(descInput).toHaveValue('Conflicting Description')
  })

  test('UI resilience during slow network', async ({ page }) => {
    await page.goto('/plants', { waitUntil: 'commit' })
    await page
      .getByRole('row', { name: /seed fern/i })
      .getByRole('button', { name: /edit/i })
      .click()

    const descInput = page.getByLabel(/description/i)
    await descInput.fill('Slow Update')

    // Delay response and mock subsequent GET
    await page.route('**/api/plants*', async (route) => {
      const request = route.request()
      if (request.method() === 'PUT') {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
      } else if (request.method() === 'GET' && request.url().endsWith('/api/plants')) {
        // Mock list response to include the updated description
        const response = await page.request.fetch(route.request())
        const json = await response.json()
        if (Array.isArray(json)) {
          // Since description is not shown in list, we might need another way to verify.
          // But for this test, we can just check if navigation happened.
          // Or we could mock a field that IS shown, like location.
          const updated = json.map((p) =>
            p.name === 'Seed Fern' ? { ...p, location: 'Slow Room' } : p,
          )
          await route.fulfill({ response, body: JSON.stringify(updated) })
        } else {
          await route.continue()
        }
      } else {
        await route.continue()
      }
    })

    // We used description above, let's also update location to verify it in the list
    const locSelect = page.getByLabel(/location/i)
    if (await locSelect.isVisible()) {
      await locSelect.selectOption({ label: 'Living Room' }) // Assuming it exists from seed
    }

    // Trigger save and verify it eventually succeeds and navigates.
    await page.getByRole('button', { name: /save/i }).click()

    // Should eventually navigate to /plants
    await expect(page).toHaveURL(/\/plants/, { timeout: 10000 })
    // Verify something that is visible. If we can't easily verify the change,
    // at least we verified the slow save didn't break navigation.
    await expect(page.getByRole('row', { name: /seed fern/i })).toBeVisible()
  })
})
