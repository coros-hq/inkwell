import { test, expect } from './fixtures'

// `> [!TYPE]` blockquotes render as coloured alerts — see src/lib/alerts.ts.
test.describe('alerts', () => {
  test('render as alerts in the live editor, plain quotes stay quotes', async ({ app }) => {
    await app.getByText('Alerts', { exact: true }).first().click()
    const editor = app.locator('.cm-content')
    await expect(editor).toContainText('Back up first.')

    await expect(app.locator('.cm-line.cm-line-alert.md-alert-warning')).toHaveCount(2)
    await expect(app.locator('.cm-line.cm-line-alert.md-alert-tip')).toHaveCount(2)
    await expect(app.locator('.cm-line.cm-line-blockquote')).toHaveCount(1)

    // Marker replaced by icon + label (default title) — custom title kept as text.
    await expect(app.locator('.md-alert-tip .cm-alert-title')).toHaveText('Tip')
    await expect(app.locator('.md-alert-warning .cm-alert-custom-title')).toHaveText('Heads up')
    await expect(editor).not.toContainText('[!TIP]')
  })

  test('render as alerts in reading view', async ({ app }) => {
    await app.getByText('Alerts', { exact: true }).first().click()
    await app.getByRole('button', { name: 'Reading view' }).click()

    const warning = app.locator('.md-alert.md-alert-warning')
    await expect(warning.locator('.md-alert-title')).toHaveText('Heads up')
    await expect(warning).toContainText('Back up first.')
    await expect(warning).not.toContainText('[!WARNING]')

    const tip = app.locator('.md-alert.md-alert-tip')
    await expect(tip.locator('.md-alert-title')).toHaveText('Tip')
    await expect(tip).toContainText('Use the slash menu.')

    await expect(app.locator('blockquote')).toHaveText('Just a quote.')
  })

  test('slash menu: Alert opens a sub-menu of types', async ({ app, disk }) => {
    await app.getByText('Welcome', { exact: true }).first().click()
    const editor = app.locator('.cm-content')
    await expect(editor).toContainText('Hello from the e2e vault.')
    await editor.click()
    await app.keyboard.press('ControlOrMeta+End')
    await app.keyboard.press('Enter')
    await app.keyboard.type('/alert')
    const menu = app.locator('.cm-tooltip-autocomplete')
    // Click rather than Enter: CodeMirror ignores Enter for ~75ms after the popup opens.
    await menu.locator('li', { hasText: 'Alert' }).first().click()

    // The sub-menu lists every type, in order.
    await expect(menu.locator('li .cm-completionLabel')).toHaveText(['Note', 'Tip', 'Important', 'Warning', 'Caution'])
    await app.keyboard.type('wa') // filters within the sub-menu
    await expect(menu.locator('li .cm-completionLabel')).toHaveText(['Warning'])
    await menu.locator('li', { hasText: 'Warning' }).click()
    await app.keyboard.type('Mind the gap')
    await expect.poll(() => disk.read('/home/e2e/vault/Welcome.md')).toContain('> [!WARNING]\n> Mind the gap')
  })

  test('slash menu: backspace from the sub-menu returns to the main menu', async ({ app }) => {
    await app.getByText('Welcome', { exact: true }).first().click()
    const editor = app.locator('.cm-content')
    await expect(editor).toContainText('Hello from the e2e vault.')
    await editor.click()
    await app.keyboard.press('ControlOrMeta+End')
    await app.keyboard.press('Enter')
    await app.keyboard.type('/alert/')
    const menu = app.locator('.cm-tooltip-autocomplete')
    await expect(menu.locator('li .cm-completionLabel')).toHaveCount(5)
    await app.keyboard.press('Backspace')
    await expect(menu.locator('li .cm-completionLabel').first()).toHaveText('Alert  ›')
  })
})
