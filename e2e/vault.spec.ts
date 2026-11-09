import { test, expect, VAULT } from './fixtures'


test.describe('vault', () => {
  test('restores the last vault and shows folders and notes', async ({ app }) => {
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
    await expect(app.getByText('Projects', { exact: true }).first()).toBeVisible()
    // The first note is opened in the editor.
    await expect(app.locator('.cm-content')).toContainText('Hello from the e2e vault.')
  })

  test('opens another note from the sidebar', async ({ app }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toContainText('milk')
  })

  test('expanding a folder lists its notes', async ({ app }) => {
    await app.getByText('Projects', { exact: true }).first().click()
    await app.getByText('Roadmap', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toContainText('Ship the e2e suite.')
  })
})

test.describe('editing', () => {
  test('typing is autosaved to disk', async ({ app, disk }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    const editor = app.locator('.cm-content')
    await editor.click()
    await app.keyboard.press('ControlOrMeta+End')
    await app.keyboard.type('\n- bread')
    await expect.poll(() => disk.read(`${VAULT}/Groceries.md`), { timeout: 10_000 }).toContain('- bread')
    // Existing content is preserved.
    expect(await disk.read(`${VAULT}/Groceries.md`)).toContain('- milk')
  })

  test('toolbar bold wraps the selection', async ({ app, disk }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await app.locator('.cm-content').click()
    await app.keyboard.press('ControlOrMeta+a')
    await app.getByRole('button', { name: 'B', exact: true }).first().click()
    await expect.poll(() => disk.read(`${VAULT}/Groceries.md`), { timeout: 10_000 }).toContain('**')
  })
})

test.describe('notes', () => {
  test('creates a new note', async ({ app, disk }) => {
    const before = await disk.list(VAULT)
    await app.getByTitle('New note').first().click()
    await expect.poll(async () => (await disk.list(VAULT)).filter((n) => n.endsWith('.md')).length, { timeout: 10_000 })
      .toBeGreaterThan(before.filter((n) => n.endsWith('.md')).length)
  })

  test('deleting a note moves it to trash and it can be restored', async ({ app, disk }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await app.getByTitle('Delete note').last().click()
    await app.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect.poll(() => disk.exists(`${VAULT}/Groceries.md`)).toBe(false)
    expect((await disk.list(`${VAULT}/.inkwell/trash`)).some((n) => n.includes('Groceries.md'))).toBe(true)

    await app.getByText('Trash', { exact: true }).first().click()
    await expect(app.getByText('Groceries').first()).toBeVisible()
    await app.getByTitle('Restore to original location').first().click()
    await expect.poll(() => disk.exists(`${VAULT}/Groceries.md`)).toBe(true)
  })

  test('trash can be permanently purged', async ({ app, disk }) => {
    await app.getByText('Groceries', { exact: true }).first().click()
    await app.getByTitle('Delete note').last().click()
    await app.getByRole('button', { name: 'Delete', exact: true }).click()
    await app.getByText('Trash', { exact: true }).first().click()
    await app.getByTitle('Delete forever').first().click()
    await app.getByRole('button', { name: 'Delete forever' }).click()
    await expect.poll(async () => (await disk.list(`${VAULT}/.inkwell/trash`)).filter((n) => n.endsWith('Groceries.md')).length).toBe(0)
  })
})

test.describe('search', () => {
  test('⌘K search finds a note by content', async ({ app }) => {
    await app.keyboard.press('ControlOrMeta+k')
    const input = app.getByPlaceholder('Search notes...')
    await expect(input).toBeVisible()
    await input.fill('eggs')
    await expect(app.getByText('Groceries').first()).toBeVisible()
    await app.keyboard.press('Enter')
    await expect(app.locator('.cm-content')).toContainText('eggs')
  })
})

test.describe('navigation', () => {
  test('switches between Notes, Board and Trash', async ({ app }) => {
    await app.getByText('Board', { exact: true }).first().click()
    await expect(app.locator('.cm-content')).toHaveCount(0)
    await app.getByText('Trash', { exact: true }).first().click()
    await expect(app.getByText(/trash is empty|nothing in trash|empty/i).first()).toBeVisible()
    await app.getByText('Notes', { exact: true }).first().click()
    await expect(app.getByText('Roadmap').first()).toBeVisible()
  })
})
