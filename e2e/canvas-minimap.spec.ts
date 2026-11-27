import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Minimap: bottom-right overview of the board, toggled by button or ⇧M, click to pan.
// Set CANVAS_SHOTS=<dir> to also save screenshots of each step.
const SHOTS = process.env.CANVAS_SHOTS

async function openCanvas(app: Page) {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.locator('canvas').first()).toBeVisible()
  await app.waitForTimeout(400)
}

async function shot(app: Page, name: string) { if (SHOTS) await app.screenshot({ path: `${SHOTS}/${name}.png` }) }

/** Snapshot of the minimap's pixels. */
async function mapPixels(app: Page) {
  return app.getByTestId('canvas-minimap').evaluate((c: HTMLCanvasElement) => c.toDataURL())
}

test('minimap shows the board, pans the view on click, and toggles', async ({ app }) => {
  await openCanvas(app)
  const map = app.getByTestId('canvas-minimap')
  await expect(map).toBeVisible()

  const empty = await mapPixels(app)
  await app.keyboard.press('r'); await app.mouse.click(500, 350)
  await app.keyboard.press('r'); await app.mouse.click(900, 500)
  await app.keyboard.press('Escape')
  await app.waitForTimeout(100)
  expect(await mapPixels(app)).not.toBe(empty)
  await shot(app, 'minimap-1-shapes')

  // Clicking a corner of the minimap pans the main view (the drawn shapes move on screen).
  const main = app.locator('canvas').first()
  const before = await main.screenshot()
  const mb = (await map.boundingBox())!
  await app.mouse.click(mb.x + 8, mb.y + 8)
  await app.waitForTimeout(100)
  expect((await main.screenshot()).equals(before)).toBe(false)
  await shot(app, 'minimap-2-panned')

  // ⇧M hides it; the toolbar's More menu brings it back.
  await app.keyboard.press('Shift+M')
  await expect(map).toHaveCount(0)
  await app.getByTitle('More', { exact: true }).click()
  await app.getByRole('button', { name: /Minimap/ }).click()
  await expect(app.getByTestId('canvas-minimap')).toBeVisible()
  await app.mouse.click(10, 10) // close the menu

  // Hidden state survives a reload.
  await app.keyboard.press('Shift+M')
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.getByTestId('canvas-minimap')).toHaveCount(0)
})
