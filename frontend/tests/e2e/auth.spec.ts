import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Session Timeout & Re-authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('UI handles 401 Unauthorized by showing error message', async ({ page }) => {
    // Intercept all API calls and return 401 to simulate expired session
    await page.route('**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/')) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Session expired' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/dashboard')
    // Wait for at least one API request to respond with 401 and for any loading indicator to finish
    await page.waitForResponse((res) => res.url().includes('/api/') && res.status() === 401)
    await expect(page.getByRole('status', { name: /loading/i })).not.toBeVisible()

    // Verification: Ensure the UI shows a "Session Expired" notification or equivalent error message
    // Based on Dashboard.jsx code: {error && <ErrorNotice message={error} />}
    const errorNotice = page.locator('[role="alert"]')
    await expect(errorNotice).toBeVisible()
    await expect(errorNotice).toContainText(/session expired/i)
  })
})
