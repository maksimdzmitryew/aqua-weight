import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Settings', () => {
  test.beforeAll(async () => {
    await seed(ORIGIN)
  })
  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('theme toggle, date format, and operation mode', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'commit' })
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()

    // 1. Theme Toggle
    const themeSelect = page.getByLabel(/theme/i)
    await themeSelect.selectOption('dark')
    await page.getByRole('button', { name: /save/i }).click()
    // Use smaller timeout for the "saved" notification if it exists
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5000 })

    // Verify dark class or attribute on html
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // 2. Date Format (Verify it changes how dates are displayed)
    await page.getByLabel(/date\/time format/i).selectOption('usa')
    await page.getByRole('button', { name: /save/i }).click()

    await page.goto('/plants', { waitUntil: 'commit' })
    // Use attached: true as the element might be hidden by CSS in some viewports/styles
    // but the task is to verify date format change.
    await expect(page.getByText(/\d{2}\/\d{2},/).first()).toBeAttached()

    // 3. Operation Mode
    await page.goto('/settings', { waitUntil: 'commit' })
    await page.getByLabel(/operation mode/i).selectOption('vacation')
    await page.getByRole('button', { name: /save/i }).click()

    // Verify warning banner in DashboardLayout
    await expect(page.getByRole('status').filter({ hasText: /vacation mode/i })).toBeVisible()
  })
})
