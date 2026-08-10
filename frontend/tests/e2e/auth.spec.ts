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

  test('UI handles 401 Unauthorized by redirecting to login', async ({ page }) => {
    const dummyAccessToken = 'e2e-dummy-access-token'

    // Intercept API routes: let the refresh endpoint succeed so the client
    // retries the original request, which then returns 401 and triggers
    // the terminal unauthenticated flow.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) {
        await route.continue()
        return
      }
      if (url.pathname === '/api/auth/refresh') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: dummyAccessToken, token_type: 'bearer' }),
        })
      } else if (!url.pathname.startsWith('/api/test/')) {
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
    // Wait for the mocked expired-session API response. The API client refreshes
    // once, retries the original request, then the session manager redirects.
    await page.waitForResponse((res) => res.url().includes('/api/') && res.status() === 401)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible()
  })

  test('UI handles expired refresh token by redirecting to login without loop', async ({
    page,
  }) => {
    // Mock ALL API routes (including refresh) to return 401
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) {
        await route.continue()
        return
      }
      if (!url.pathname.startsWith('/api/test/')) {
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
    // Should redirect to login without infinite refresh loop
    await expect(page).toHaveURL(/\/login$/, { timeout: 10000 })
    // Verify login heading is visible
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible()
  })

  test('user can re-authenticate after session expiry', async ({ page }) => {
    // Trigger session expiry with refresh token still working
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) {
        await route.continue()
        return
      }
      if (url.pathname === '/api/auth/refresh') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'e2e-dummy-access-token', token_type: 'bearer' }),
        })
      } else if (!url.pathname.startsWith('/api/test/')) {
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
    await expect(page).toHaveURL(/\/login$/)

    // Re-login
    await page.getByLabel(/username/i).fill('admin')
    await page.getByLabel(/password/i).fill('adminpassword')
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 })
    await expect(page.locator('.sidebar-title')).toHaveText(/dashboard/i)
  })
})
