import { test, expect, VAULT } from './fixtures'
import type { Page } from '@playwright/test'

const toggle = (app: Page) => app.getByRole('button', { name: 'Reading view' })

test.describe('reading view', () => {
  test('shows the note rendered and read-only, then returns to editing', async ({ app, disk }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toContainText('milk')

    await toggle(app).click()
    await expect(toggle(app)).toHaveAttribute('aria-pressed', 'true')
    await expect(app.locator('.cm-content')).toHaveCount(0)
    await expect(app.getByRole('heading', { name: 'Groceries' })).toBeVisible()
    await expect(app.getByText('milk').first()).toBeVisible()

    // Typing does nothing — the file is untouched.
    await app.keyboard.type('should not appear')
    await app.waitForTimeout(500)
    expect(await disk.read(`${VAULT}/Groceries.md`)).not.toContain('should not appear')

    await toggle(app).click()
    await expect(app.locator('.cm-content')).toContainText('milk')
    await expect(toggle(app)).toHaveAttribute('aria-pressed', 'false')
  })

  test('⌘E toggles it from the keyboard', async ({ app }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toBeVisible()
    await app.keyboard.press('ControlOrMeta+e')
    await expect(app.locator('.cm-content')).toHaveCount(0)
    await app.keyboard.press('ControlOrMeta+e')
    await expect(app.locator('.cm-content')).toBeVisible()
  })

  test('leaving view restores the mode the note was in (split → view → split)', async ({ app }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await app.getByTitle('Switch to Markdown mode').click()
    await expect(app.getByRole('separator')).toBeVisible() // split divider

    await toggle(app).click()
    await expect(app.getByRole('separator')).toHaveCount(0)
    await toggle(app).click()
    await expect(app.getByRole('separator')).toBeVisible()
  })

  test('is per note and never remembered across launches', async ({ app }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await toggle(app).click()
    await expect(app.locator('.cm-content')).toHaveCount(0)

    // Another note is unaffected.
    await app.getByText('Welcome', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toContainText('Hello from the e2e vault.')

    // Nothing view-related reaches localStorage, so a reload can't strand a note read-only.
    const saved = await app.evaluate(() => localStorage.getItem('inkwell-note-editor-modes') ?? '{}')
    expect(saved).not.toContain('view')
  })

  test('find-in-note works in reading view', async ({ app }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await toggle(app).click()
    await app.keyboard.press('ControlOrMeta+f')
    const box = app.getByPlaceholder(/find/i).first()
    await expect(box).toBeVisible()
    await box.fill('milk')
    // The rendered text gets a highlight on the match.
    await expect(app.locator('mark, [class*="search-match"], [class*="highlight"]').filter({ hasText: 'milk' }).first()).toBeVisible()
  })
})
