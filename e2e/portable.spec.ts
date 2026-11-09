import { test, expect, VAULT, SEED_FILES } from './fixtures'
import { installTauriMock } from './fixtures/tauriMock'

const ROOT = '/apps/inkwell/data'
// Where an installed copy keeps its global files (the mock's "home" is /home/e2e/Documents).
const OS_HOME_DIR = '/home/e2e/Documents/.inkwell'

test.describe('portable build', () => {
  test.use({ portableRoot: ROOT })

  test('keeps the active-vault file inside its own data folder, not the home directory', async ({ app, disk }) => {
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
    await expect.poll(() => disk.read(`${ROOT}/config/active-vault`)).toBe(VAULT)
    expect(await disk.exists(OS_HOME_DIR)).toBe(false)
  })

  test('Settings → About shows where the data lives', async ({ openSettings }) => {
    const settings = await openSettings()
    await settings.getByRole('button', { name: 'About' }).click()
    const info = settings.getByTestId('portable-info')
    await expect(info).toContainText('Portable mode')
    await expect(info).toContainText(ROOT)
    await expect(info.getByRole('button', { name: 'Show data folder' })).toBeVisible()
  })
})

test.describe('installed build (not portable)', () => {
  test('uses the normal home-directory location and shows no portable notice', async ({ app, disk, openSettings }) => {
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
    await expect.poll(() => disk.read(`${OS_HOME_DIR}/active-vault`)).toBe(VAULT)
    expect(await disk.exists(`${ROOT}`)).toBe(false)

    const settings = await openSettings()
    await settings.getByRole('button', { name: 'About' }).click()
    await expect(settings.getByTestId('portable-info')).toHaveCount(0)
  })
})

test.describe('first run of a portable copy', () => {
  test('suggests a vault inside the app folder, not in Documents', async ({ page }) => {
    await page.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES, portableRoot: ROOT, openVault: false })
    await page.goto('/')
    await expect(page.getByText(`${ROOT}/Vault`).first()).toBeVisible()
    await expect(page.getByText('Documents/Inkwell')).toHaveCount(0)
  })

  test('an installed copy still suggests ~/Documents', async ({ page }) => {
    await page.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES, openVault: false })
    await page.goto('/')
    await expect(page.getByText('/home/e2e/Documents/Inkwell/Vault').first()).toBeVisible()
  })
})

test.describe('moving the portable folder', () => {
  const OLD = '/old/place'
  const NEW = '/new/place'
  const NEW_VAULT = `${NEW}/data/Vault`

  test('vaults inside the folder are found again; others are left alone', async ({ page }) => {
    await page.addInitScript(installTauriMock, {
      vaultPath: NEW_VAULT,
      files: { [`${NEW_VAULT}/Moved note.md`]: '# Moved note\n\nStill here.\n' },
      portableRoot: `${NEW}/data`,
    })
    // What the profile remembers from before the move (runs after the mock, so it wins).
    await page.addInitScript(([old]) => {
      localStorage.setItem('inkwell-portable-root', `${old}/data`)
      localStorage.setItem('inkwell-last-vault', `${old}/data/Vault`)
      localStorage.setItem('inkwell-backup-dir', `${old}/Backups`)
      localStorage.setItem('inkwell-recent-vaults', JSON.stringify([
        { path: `${old}/data/Vault`, name: 'Vault', lastOpenedAt: '2026-01-01T00:00:00.000Z' },
        { path: '/elsewhere/notes', name: 'notes', lastOpenedAt: '2026-01-01T00:00:00.000Z' },
      ]))
      localStorage.setItem(`inkwell-backup-last:${old}/data/Vault`, '2026-01-01T00:00:00.000Z')
    }, [OLD])
    await page.goto('/')

    // The remembered vault opened from its new location.
    await expect(page.getByText('Moved note', { exact: true }).first()).toBeVisible()

    const ls = await page.evaluate(() => ({
      last: localStorage.getItem('inkwell-last-vault'),
      backup: localStorage.getItem('inkwell-backup-dir'),
      root: localStorage.getItem('inkwell-portable-root'),
      recents: JSON.parse(localStorage.getItem('inkwell-recent-vaults')!).map((v: { path: string }) => v.path),
      keys: Object.keys(localStorage).filter((k) => k.startsWith('inkwell-backup-last:')),
    }))
    expect(ls.last).toBe(NEW_VAULT)
    expect(ls.backup).toBe(`${NEW}/Backups`)
    expect(ls.root).toBe(`${NEW}/data`)
    expect(ls.recents).toEqual(expect.arrayContaining([NEW_VAULT, '/elsewhere/notes']))
    expect(ls.recents).not.toContain(`${OLD}/data/Vault`)
    // Per-vault entries follow the vault to its new path.
    expect(ls.keys).toEqual([`inkwell-backup-last:${NEW_VAULT}`])
  })

  test('a folder that has not moved is left untouched', async ({ page }) => {
    await page.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES, portableRoot: ROOT })
    await page.addInitScript(([root]) => {
      localStorage.setItem('inkwell-portable-root', root)
      localStorage.setItem('inkwell-recent-vaults', JSON.stringify([{ path: '/anywhere/else', name: 'else', lastOpenedAt: '2026-01-01T00:00:00.000Z' }]))
    }, [ROOT])
    await page.goto('/')
    await expect(page.getByText('Groceries', { exact: true }).first()).toBeVisible()
    const recents = await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-recent-vaults')!).map((v: { path: string }) => v.path))
    expect(recents).toContain('/anywhere/else')
  })
})
