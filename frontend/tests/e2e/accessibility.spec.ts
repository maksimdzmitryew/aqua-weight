import { test, expect } from '@playwright/test'
import { seed, cleanup } from './utils/seed'

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

test.describe('Keyboard Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN)
    await page.goto('/dashboard')
  })

  test.afterAll(async () => {
    await cleanup(ORIGIN)
  })

  test('navigating through Dashboard and Plant List via keyboard', async ({ page }) => {
    // Start at Dashboard
    await page.goto('/dashboard')

    // Tab until we find "Plants" link
    let found = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const text = await page.evaluate(() => document.activeElement?.textContent || '')
      if (/plants/i.test(text)) {
        found = true
        break
      }
    }
    expect(found, 'Should find "Plants" link via keyboard').toBe(true)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/plants$/)

    // In Plant List, tab through rows
    await expect(page.getByRole('table')).toBeVisible()

    // Tab to find any button with "Edit" in its label (IconButton uses aria-label)
    found = false
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab')
      const label = await page.evaluate(() => {
        const el = document.activeElement
        return el?.getAttribute('aria-label') || el?.textContent || ''
      })
      if (/edit/i.test(label)) {
        found = true
        break
      }
    }
    expect(found, 'Should find "Edit" button via keyboard').toBe(true)

    // Ensure focus indicator is visible
    const outline = await page.evaluate(() => {
      const style = window.getComputedStyle(document.activeElement!)
      // We look for outline or box-shadow which is often used for focus rings
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
    })
    expect(outline).toBe(true)
  })

  test('interactive cards on Dashboard are triggerable via keyboard', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for plant cards
    await expect(page.locator('.plant-card').first()).toBeVisible()

    // Tab until we hit a plant card.
    let found = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const isCard = await page.evaluate(() => {
        const el = document.activeElement
        return el?.classList.contains('plant-card') || el?.closest('.plant-card') !== null
      })
      if (isCard) {
        found = true
        break
      }
    }
    expect(found, 'Should find a plant card via keyboard').toBe(true)

    await page.keyboard.press('Enter')
    // Clicking a card should navigate to stats
    await expect(page).toHaveURL(/\/stats\/[a-f0-9-]{32,36}/)
  })

  test('form interaction and validation via keyboard', async ({ page }) => {
    await page.goto('/plants')

    // Find "+ Create" button via keyboard in PageHeader
    let found = false
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab')
      const text = await page.evaluate(() => document.activeElement?.textContent || '')
      const label = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') || '',
      )
      if (/\+ Create/i.test(text) || /\+ Create/i.test(label)) {
        found = true
        break
      }
    }
    expect(found, 'Should find "+ Create" button via keyboard').toBe(true)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/plants\/new$/)

    // Fill the form using keyboard
    // Wait for form to be visible
    await expect(page.locator('form')).toBeVisible()

    // Type name
    await page.locator('#name').focus()
    await page.keyboard.type('Keyboard Plant')

    // Check if name was actually typed
    const nameVal = await page.evaluate(
      () => (document.getElementById('name') as HTMLInputElement)?.value,
    )
    expect(nameVal).toBe('Keyboard Plant')

    // Tab to submit button
    found = false
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const text = await page.evaluate(() => document.activeElement?.textContent || '')
      const type = await page.evaluate(
        () => (document.activeElement as HTMLButtonElement)?.type || '',
      )
      const tag = await page.evaluate(() => document.activeElement?.tagName || '')

      if (tag === 'BUTTON' && /save/i.test(text) && type === 'submit') {
        found = true
        break
      }
    }
    expect(found, 'Should find submit button via keyboard').toBe(true)
    await page.keyboard.press('Enter')

    // After creation, should be on plant details or list
    // The current code in PlantCreate.jsx says navigate('/plants')
    await expect(page).toHaveURL(/\/plants$/)
    await expect(page.getByText('Keyboard Plant')).toBeVisible()
  })

  test('search and filter interaction via keyboard', async ({ page }) => {
    await page.goto('/plants')

    // Wait for table to be loaded
    await expect(page.locator('table')).toBeVisible()

    // Focus search input
    let found = false
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab')
      const ariaLabel = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') || '',
      )
      const placeholder = await page.evaluate(
        () => (document.activeElement as HTMLInputElement)?.placeholder || '',
      )
      if (/search plants/i.test(ariaLabel) || /search/i.test(placeholder)) {
        found = true
        break
      }
    }
    expect(found, 'Should find search input via keyboard').toBe(true)

    await page.keyboard.type('NonExistentPlantNameThatWillNotBeFound')
    // The list should update to show empty state instead of table
    await expect(page.getByRole('note')).toContainText(/No plants found/i)

    // Clear search using keyboard
    // Some systems use Command+A, some Control+A
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0)
    const modifier = isMac ? 'Meta' : 'Control'
    await page.keyboard.down(modifier)
    await page.keyboard.press('a')
    await page.keyboard.up(modifier)
    await page.keyboard.press('Backspace')

    await expect(page.locator('table tbody tr').first()).toBeVisible()
  })

  test('sidebar navigation via keyboard', async ({ page }) => {
    // Tab to sidebar links
    // From DashboardLayout.jsx: Overview, Daily Care, Plants, Calibration, Locations, Settings
    const sidebarLinks = [
      'Overview',
      'Daily Care',
      'Plants',
      'Calibration',
      'Locations',
      'Settings',
    ]

    for (const linkText of sidebarLinks) {
      let found = false
      await page.goto('/dashboard')

      // Reset focus to the start of the document
      await page.keyboard.press('Control+Home') // Just in case

      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement
          return {
            text: el?.textContent || '',
            tag: el?.tagName || '',
            classList: Array.from(el?.classList || []),
          }
        })

        if (
          info.tag === 'A' &&
          info.classList.includes('nav-link') &&
          new RegExp(linkText, 'i').test(info.text)
        ) {
          found = true
          break
        }
      }
      expect(found, `Should find sidebar link "${linkText}" via keyboard`).toBe(true)
      await page.keyboard.press('Enter')

      // Check URL
      if (linkText === 'Overview') {
        await expect(page).toHaveURL(/\/dashboard$/)
      } else if (linkText === 'Daily Care') {
        await expect(page).toHaveURL(/\/daily$/)
      } else {
        const expectedPath = linkText.toLowerCase().replace(' ', '')
        await expect(page).toHaveURL(new RegExp(expectedPath, 'i'))
      }
    }
  })
})
