import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme)

test.describe('settings window', () => {
  test('opens as its own window, not a dialog in the app', async ({ app, openSettings }) => {
    const settings = await openSettings()
    expect(settings.url()).toContain('settings=1')
    expect(settings).not.toBe(app)
    // Nothing is overlaid on the main window.
    await expect(app.getByRole('dialog')).toHaveCount(0)
    // The new window shows the settings UI, with no app chrome from the main window.
    await expect(settings.getByRole('button', { name: 'Appearance' })).toBeVisible()
    await expect(settings.getByText('Groceries')).toHaveCount(0)
  })

  test('asking for Settings again reuses the same window', async ({ app, context, openSettings }) => {
    await openSettings()
    await app.getByText('Settings', { exact: true }).first().click()
    await app.waitForTimeout(300)
    expect(context.pages()).toHaveLength(2)
  })

  test('does not offer a Team section', async ({ openSettings }) => {
    const settings = await openSettings()
    await expect(settings.getByRole('button', { name: 'Claude' })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'About' })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Team' })).toHaveCount(0)
  })

  test('picking a theme in Settings changes the main window and Settings itself', async ({ app, openSettings }) => {
    const settings = await openSettings()
    const before = await theme(app)
    await settings.getByTitle('Parchment').click()
    await expect.poll(() => theme(app)).toBe('parchment')
    await expect.poll(() => theme(settings)).toBe('parchment')
    expect(before).not.toBe('parchment')
  })

  test('the main window stays interactive while Settings is open', async ({ app, openSettings }) => {
    await openSettings()
    await app.getByText('Groceries', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toContainText('milk')
  })

  test('"Share vault" opens the share dialog in the main window', async ({ app, openSettings }) => {
    const settings = await openSettings()
    await settings.getByRole('button', { name: 'Vaults' }).click()
    await settings.getByRole('button', { name: 'Share vault' }).first().click()
    await expect(app.getByRole('dialog')).toBeVisible()
  })

  test('is a regular window: closing it leaves the app running', async ({ app, openSettings }) => {
    const settings = await openSettings()
    await settings.close()
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
    // And it can be opened again.
    const again = await openSettings()
    await expect(again.getByRole('button', { name: 'Themes' })).toBeVisible()
  })
})

test.describe('settings window on Windows', () => {
  test.use({ platform: 'Win32' })

  test('draws its own titlebar with the title and window controls', async ({ openSettings }) => {
    const settings = await openSettings()
    const bar = settings.getByTestId('settings-titlebar')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('Settings')
    for (const name of ['Minimize', 'Maximize', 'Close']) await expect(bar.getByRole('button', { name })).toBeVisible()
  })

  test('its close button closes just that window', async ({ app, openSettings }) => {
    const settings = await openSettings()
    await settings.getByTestId('settings-titlebar').getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => settings.isClosed()).toBe(true)
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
  })
})
