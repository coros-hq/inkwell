import { test, expect, VAULT } from './fixtures'

const boardsJson = async (disk: { read: (p: string) => Promise<string | null> }) =>
  JSON.parse((await disk.read(`${VAULT}/.inkwell/boards.json`))!).boards[0]

test.describe('board backgrounds', () => {
  test.beforeEach(async ({ app }) => {
    await app.getByText('Board', { exact: true }).first().click()
    await expect(app.getByRole('tab', { name: 'Sprint' })).toBeVisible()
  })

  test('picking a gradient paints the board and persists to boards.json', async ({ app, disk }) => {
    await app.getByRole('button', { name: 'Board background' }).click()
    await app.getByRole('button', { name: 'Ocean' }).click()

    await expect.poll(async () => (await boardsJson(disk)).background).toEqual({
      type: 'gradient',
      value: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
    })
    // The wallpaper is applied to the board surface.
    const surface = app.locator('div.flex-1.flex-col.overflow-hidden').filter({ has: app.getByRole('tablist') }).first()
    await expect(surface).toHaveCSS('background-image', /linear-gradient/)
  })

  test('picking a solid color, then removing it', async ({ app, disk }) => {
    await app.getByRole('button', { name: 'Board background' }).click()
    await app.getByRole('button', { name: 'Green' }).click()
    await expect.poll(async () => (await boardsJson(disk)).background).toEqual({ type: 'color', value: '#519839' })

    await app.getByRole('button', { name: 'Remove' }).click()
    await expect.poll(async () => (await boardsJson(disk)).background).toBeUndefined()
  })

  test('uploading an image copies it into the vault and references it', async ({ app, disk }) => {
    await app.evaluate(() => (window as any).__e2e.setDialogPath('/home/e2e/Pictures/wall.png'))
    await app.getByRole('button', { name: 'Board background' }).click()
    await app.getByRole('button', { name: 'Upload image…' }).click()

    await expect.poll(async () => (await boardsJson(disk)).background?.type).toBe('image')
    const { path } = (await boardsJson(disk)).background
    expect(path).toMatch(/^assets\/board-backgrounds\/bg-.*\.png$/)
    expect(await disk.exists(`${VAULT}/${path}`)).toBe(true)
  })

  test('the choice is also backed up to localStorage', async ({ app }) => {
    await app.getByRole('button', { name: 'Board background' }).click()
    await app.getByRole('button', { name: 'Dusk' }).click()
    // flushBoards writes a synchronous localStorage copy alongside the disk write.
    await expect.poll(() => app.evaluate(() => localStorage.getItem('inkwell-boards:/home/e2e/vault'))).toContain('#764ba2')
  })

  test('the picker is drawn above the columns, not behind them', async ({ app }) => {
    // With a wallpaper set, the top bar and columns are both frosted layers; the popover must still win.
    await app.getByRole('button', { name: 'Board background' }).click()
    await app.getByRole('button', { name: 'Dusk' }).click()
    const dialog = app.getByRole('dialog', { name: 'Board background' })
    await expect(dialog).toBeVisible()

    const box = (await dialog.boundingBox())!
    // The popover must overlap a column for this test to mean anything.
    const col = (await app.getByText('Done', { exact: true }).first().boundingBox())!
    expect(box.x < col.x + 260 && box.x + box.width > col.x).toBe(true)

    for (const [fx, fy] of [[0.2, 0.3], [0.5, 0.5], [0.8, 0.9]]) {
      const hit = await app.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest('[role="dialog"][aria-label="Board background"]')
      }, [box.x + box.width * fx, box.y + box.height * fy])
      expect(hit, `point ${fx},${fy} is covered by something else`).toBe(true)
    }
  })
})
