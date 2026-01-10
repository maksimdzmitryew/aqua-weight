import { test, expect } from '@playwright/test';
import { seed, cleanup } from './utils/seed';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

test.describe('Keyboard Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await seed(ORIGIN);
    await page.goto('/dashboard');
  });

  test.afterEach(async () => {
    await cleanup(ORIGIN);
  });

  test('navigating through Dashboard and Plant List via keyboard', async ({ page }) => {
    // Start at Dashboard
    await page.goto('/dashboard');
    
    // Tab until we find "Plants" link
    let found = false;
    for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const text = await page.evaluate(() => document.activeElement?.textContent || '');
        if (/plants/i.test(text)) {
            found = true;
            break;
        }
    }
    expect(found, 'Should find "Plants" link via keyboard').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/plants$/);

    // In Plant List, tab through rows
    await expect(page.getByRole('table')).toBeVisible();
    
    // Tab to find any button with "Edit" in its label (IconButton uses aria-label)
    found = false;
    for (let i = 0; i < 50; i++) {
        await page.keyboard.press('Tab');
        const label = await page.evaluate(() => {
            const el = document.activeElement;
            return el?.getAttribute('aria-label') || el?.textContent || '';
        });
        if (/edit/i.test(label)) {
            found = true;
            break;
        }
    }
    expect(found, 'Should find "Edit" button via keyboard').toBe(true);
    
    // Ensure focus indicator is visible
    const outline = await page.evaluate(() => {
        const style = window.getComputedStyle(document.activeElement!);
        // We look for outline or box-shadow which is often used for focus rings
        return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    });
    expect(outline).toBe(true);
  });

  test('interactive cards on Dashboard are triggerable via keyboard', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Wait for plant cards
    await expect(page.locator('.plant-card').first()).toBeVisible();

    // Tab until we hit a plant card. 
    let found = false;
    for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const isCard = await page.evaluate(() => {
            const el = document.activeElement;
            return el?.classList.contains('plant-card') || el?.closest('.plant-card') !== null;
        });
        if (isCard) {
            found = true;
            break;
        }
    }
    expect(found, 'Should find a plant card via keyboard').toBe(true);
    
    await page.keyboard.press('Enter');
    // Clicking a card should navigate to stats
    await expect(page).toHaveURL(/\/stats\/[a-f0-9-]{32,36}/);
  });
});
