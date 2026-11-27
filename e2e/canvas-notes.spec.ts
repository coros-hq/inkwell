import { test, expect } from './fixtures'

// Diagram notes: a side sheet with the live markdown editor, resizable.
// Set CANVAS_SHOTS=<dir> to also save screenshots.
const SHOTS = process.env.CANVAS_SHOTS

test('diagram notes use the live markdown editor in a resizable sheet', async ({ app }) => {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.locator('canvas').first()).toBeVisible()

  await app.getByTitle('Toggle diagram notes (⌘/)').click()
  const editor = app.locator('.cm-content').last()
  await expect(editor).toBeFocused({ timeout: 2000 })

  await app.keyboard.type('# Overview')
  await app.keyboard.press('Enter')
  await app.keyboard.type('- **API** talks to the database')
  await app.keyboard.press('Enter')
  await app.keyboard.type('cache sits in front')   // list continues on Enter
  await app.keyboard.press('Enter'); await app.keyboard.press('Enter')
  await app.keyboard.type('plain paragraph')
  if (SHOTS) await app.screenshot({ path: `${SHOTS}/notes-1.png` })

  // Live preview: the heading line off the cursor hides its "# " marker.
  await expect(editor.locator('.cm-line').first()).toHaveText('Overview')
  await expect(editor.locator('.cm-line').nth(2)).toContainText('cache sits in front')

  // Default width is a side panel, not half the screen.
  const sheet = app.getByTitle('Close notes (⌘/)').locator('xpath=ancestor::div[contains(@class,"flex-col")][1]')
  const w0 = (await sheet.boundingBox())!.width
  expect(w0).toBeGreaterThan(300); expect(w0).toBeLessThan(420)

  // Drag the left edge to widen it; the width survives a reload.
  const handle = app.getByTitle('Drag to resize · double-click to reset')
  const hb = (await handle.boundingBox())!
  await app.mouse.move(hb.x + 2, hb.y + 200); await app.mouse.down()
  await app.mouse.move(hb.x - 120, hb.y + 200, { steps: 6 }); await app.mouse.up()
  await expect.poll(async () => (await sheet.boundingBox())!.width).toBeGreaterThan(w0 + 100)
  expect(await app.evaluate(() => Number(localStorage.getItem('inkwell-canvas-notes-width')))).toBeGreaterThan(w0 + 100)
})
