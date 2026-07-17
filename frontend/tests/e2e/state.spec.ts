import { test, expect } from '@playwright/test'
import { seed, cleanup, login, createApiClient } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Persistence & State Sync', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ORIGIN)
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('theme synchronization across multiple tabs', async ({ context }) => {
    await seed(ORIGIN)
    const api = await createApiClient(ORIGIN)
    try {
      const loginRes = await api.post('/api/test/login')
      expect(loginRes.ok()).toBeTruthy()
      const { access_token } = await loginRes.json()
      const settingsRes = await api.put('/api/settings', {
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        data: { settings: { theme: 'light' } },
      })
      expect(settingsRes.ok()).toBeTruthy()
    } finally {
      await api.dispose()
    }

    await context.addInitScript(() => {
      localStorage.setItem('theme', 'light')
    })
    const page1 = await context.newPage()
    const page2 = await context.newPage()

    await login(page1, ORIGIN)
    await login(page2, ORIGIN)

    await page1.goto('/settings')
    await page2.goto('/dashboard')

    // Default theme light
    await expect(page1.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page2.locator('html')).toHaveAttribute('data-theme', 'light')

    // Change theme in tab 1
    await page1.getByLabel(/theme/i).selectOption('dark')
    await page1.getByRole('button', { name: /save/i }).click()

    // Theme should update immediately in tab 1
    await expect(page1.locator('html')).toHaveAttribute('data-theme', 'dark')

    // Tab 2 might not update immediately unless we have a storage listener.
    // Let's see if it updates on focus or reload.
    // Actually, ThemeProvider.jsx doesn't seem to have a storage listener.
    // So it will likely need a reload.
    await page2.reload()
    await expect(page2.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('form dirty state and clear on navigate', async ({ page }) => {
    await seed(ORIGIN)
    await page.goto('/locations/new', { waitUntil: 'commit' })

    await page.getByLabel(/name/i).fill('Partial Name')

    // Navigate away
    await page.getByRole('link', { name: /back to locations/i }).click()
    await expect(page).toHaveURL(/\/locations/)

    // Go back and verify it's cleared (not persisted)
    await page.getByRole('button', { name: /\+\s*Create/i }).click()
    await expect(page.getByLabel(/name/i)).toHaveValue('')
  })
})
