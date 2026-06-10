import { test, expect } from '@playwright/test'
import { seed, cleanup, login } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Session Timeout & Re-authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ORIGIN)
    await seed(ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('UI handles 401 Unauthorized by showing error message', async ({ page }) => {
    // Generate a dummy access token for the mocked refresh response
    const dummyAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0X2FkbWluIiwiaWF0IjoxNzE4MDAwMDAwLCJleHAiOjE5MTgwMDAwMDB9.fake_signature'

    // Intercept all API calls (except test/*) and return 401 to simulate expired session.
    // The /api/auth/refresh endpoint is mocked to succeed so the API client refreshes
    // its token, retries the original request, gets 401 again, and surfaces the error
    // instead of redirecting to the login page.
    await page.route('**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/auth/refresh')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: dummyAccessToken, token_type: 'bearer' }),
        })
      } else if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/test/')) {
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
