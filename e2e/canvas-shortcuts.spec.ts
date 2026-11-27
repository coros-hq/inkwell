import { test, expect } from './fixtures'

test('keyboard shortcuts panel filters by search', async ({ app }) => {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.locator('canvas').first()).toBeVisible()

  await app.getByTitle('Keyboard shortcuts').click()
  const search = app.getByLabel('Search shortcuts')
  await expect(search).toBeFocused()

  // Typing letters filters instead of switching tools.
  await search.fill('zoom')
  await expect(app.getByText('Zoom to fit all')).toBeVisible()
  await expect(app.getByText('Rectangle', { exact: true })).toHaveCount(0)

  // Matches on keys too.
  await search.fill('⇧M')
  await expect(app.getByText('Toggle minimap')).toBeVisible()

  await search.fill('nothing like this')
  await expect(app.getByText(/No shortcuts match/)).toBeVisible()

  // Esc clears first, then closes.
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await search.press('Escape')
  await expect(search).toHaveCount(0)
})

test('shortcuts panel lists text editing keys', async ({ app }) => {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await app.getByTitle('Keyboard shortcuts').click()
  await app.getByLabel('Search shortcuts').fill('new line')
  await expect(app.getByText('New line in standalone text')).toBeVisible()
  await app.getByLabel('Search shortcuts').fill('')
  if (process.env.CANVAS_SHOTS) await app.screenshot({ path: `${process.env.CANVAS_SHOTS}/shortcuts.png` })
})
