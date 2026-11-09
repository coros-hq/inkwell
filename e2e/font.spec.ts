import { test, expect, VAULT, SEED_FILES } from './fixtures'
import type { Page } from '@playwright/test'
import { installTauriMock } from './fixtures/tauriMock'

const family = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)

async function pickFont(settings: Page, name: string) {
  await settings.getByRole('button', { name: 'Appearance' }).click()
  // The picker button shows the current font (the default is Inter).
  await settings.getByRole('button', { name: 'Inter' }).click()
  await settings.getByPlaceholder('Search fonts…').fill(name)
  await settings.keyboard.press('Enter')
}

test.describe('app font', () => {
  test('a custom installed font applies to the whole app, not just the editor', async ({ app, openSettings }) => {
    await expect(app.locator('.cm-content')).toBeVisible()
    await pickFont(await openSettings(), 'Zapfino Test')

    await expect.poll(() => app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-app')))
      .toContain('Zapfino Test')
    // Page chrome (body), the editor and a sidebar label all follow it.
    for (const sel of ['body', '.cm-content', 'text=Groceries']) {
      await expect.poll(() => family(app, sel), { message: sel }).toContain('Zapfino Test')
    }
  })

  test('the Settings window itself switches font too', async ({ openSettings }) => {
    const settings = await openSettings()
    await pickFont(settings, 'Zapfino Test')
    await expect.poll(() => family(settings, 'body')).toContain('Zapfino Test')
  })

  test('the choice is remembered for next launch', async ({ app, openSettings }) => {
    await pickFont(await openSettings(), 'Georgia')
    await expect.poll(() => app.evaluate(() => localStorage.getItem('inkwell-editor-fontFamily'))).toContain('Georgia')
  })

  test('a saved font is applied on startup', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('inkwell-editor-fontFamily', "'Merriweather', Georgia, serif"))
    await page.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES })
    await page.goto('/')
    await expect.poll(() => family(page, 'body')).toContain('Merriweather')
  })
})
