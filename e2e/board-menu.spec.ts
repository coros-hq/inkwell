import { test, expect } from './fixtures'

// The column "…" menu used to render inside its column; on a board with a wallpaper the
// columns are glass (their own stacking contexts), so the next column painted over the menu.
test('a column menu sits above the neighbouring columns on a wallpapered board', async ({ app }) => {
  await app.getByText('Board', { exact: true }).first().click()
  await app.getByRole('button', { name: 'Board background' }).click()
  await app.getByRole('button', { name: 'Ocean' }).click()
  await app.keyboard.press('Escape')

  const header = app.getByText('To Do', { exact: true }).first()
  await header.hover()
  await header.locator('xpath=ancestor::div[contains(@class,"group")][1]').locator('button:has(svg.lucide-ellipsis), button:has(svg.lucide-more-horizontal)').first().click()

  const del = app.getByRole('button', { name: 'Delete column' })
  await expect(del).toBeVisible()
  if (process.env.CANVAS_SHOTS) await app.screenshot({ path: `${process.env.CANVAS_SHOTS}/board-menu.png` })
  // Whatever is painted at the item's centre must be the item itself, not a column on top of it.
  const box = (await del.boundingBox())!
  const topmost = await app.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2])
  expect(topmost).toContain('Delete column')
  await del.click()
  await expect(app.getByRole('button', { name: 'Delete', exact: true }).or(app.getByText(/Delete .*column/i).first())).toBeVisible()
})
