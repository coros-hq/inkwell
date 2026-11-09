import { unzipSync } from 'fflate'
import type { Page } from '@playwright/test'
import { test, expect, VAULT, SEED_FILES, type Disk } from './fixtures'
import { installTauriMock } from './fixtures/tauriMock'

const BACKUPS = '/home/e2e/Backups'

// Backup runs in the Settings window; the (fake) disk it writes to belongs to the main window.
async function chooseFolder(app: Page, settings: Page) {
  await app.evaluate((p) => (window as any).__e2e.setDialogPath(p), BACKUPS)
  await settings.getByRole('button', { name: 'Choose folder…' }).click()
  await expect(settings.getByText(BACKUPS).first()).toBeVisible()
}

// (dnd-kit renders its own role=status live region, so match on the text instead.)
const result = (page: Page) => page.getByText(/^Backed up \d+ /)

const zips = async (disk: Disk) => (await disk.list(BACKUPS)).filter((n) => n.endsWith('.zip')).sort()

async function backupSettings(openSettings: () => Promise<Page>) {
  const settings = await openSettings()
  await settings.getByRole('button', { name: 'Backup' }).click()
  return settings
}

test.describe('local backup', () => {
  test('backing up is disabled until a folder is chosen', async ({ app, openSettings }) => {
    const settings = await backupSettings(openSettings)
    await expect(settings.getByRole('button', { name: 'Back up now' })).toBeDisabled()
    await chooseFolder(app, settings)
    // Enabled only once the main window's open vault has been mirrored into this window.
    await expect(settings.getByRole('button', { name: 'Back up now' })).toBeEnabled()
  })

  test('creates a zip of the vault, without trash or git data', async ({ app, disk, openSettings }) => {
    // Things that must stay out of the archive.
    await app.evaluate(([v]) => {
      const e = (window as any).__e2e
      e.write(`${v}/.inkwell/trash/old__Gone.md`, '# gone')
      e.write(`${v}/.git/config`, '[core]')
    }, [VAULT])

    const settings = await backupSettings(openSettings)
    await chooseFolder(app, settings)
    await settings.getByRole('button', { name: 'Back up now' }).click()
    await expect(result(settings)).toContainText('Backed up')

    const [name] = await zips(disk)
    expect(name).toMatch(/^vault-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.zip$/)
    const bytes = await disk.bytes(`${BACKUPS}/${name}`)
    const entries = Object.keys(unzipSync(new Uint8Array(bytes!)))

    expect(entries).toEqual(expect.arrayContaining(['vault/Welcome.md', 'vault/Groceries.md', 'vault/Projects/Roadmap.md', 'vault/.inkwell/boards.json']))
    expect(entries.some((e) => e.includes('trash'))).toBe(false)
    expect(entries.some((e) => e.includes('.git'))).toBe(false)
    // No half-written file is left behind.
    expect((await disk.list(BACKUPS)).some((n) => n.endsWith('.partial'))).toBe(false)
  })

  test('the archive contents match the notes', async ({ app, disk, openSettings }) => {
    const settings = await backupSettings(openSettings)
    await chooseFolder(app, settings)
    await settings.getByRole('button', { name: 'Back up now' }).click()
    await expect(result(settings)).toBeVisible()
    const [name] = await zips(disk)
    const files = unzipSync(new Uint8Array((await disk.bytes(`${BACKUPS}/${name}`))!))
    expect(new TextDecoder().decode(files['vault/Groceries.md'])).toContain('- milk')
  })

  test('keeps only the newest N backups', async ({ app, disk, openSettings }) => {
    const settings = await backupSettings(openSettings)
    await chooseFolder(app, settings)
    await settings.getByRole('button', { name: 'Last 3', exact: true }).click()
    for (let i = 0; i < 4; i++) {
      await settings.getByRole('button', { name: 'Back up now' }).click()
      await expect(settings.getByRole('button', { name: 'Back up now' })).toBeEnabled()
      await settings.waitForTimeout(15) // distinct millisecond stamps
    }
    expect(await zips(disk)).toHaveLength(3)
    await expect(result(settings)).toContainText('removed 1 older backup')
  })

  test('automatic backups can be switched on once a folder exists', async ({ app, openSettings }) => {
    const settings = await backupSettings(openSettings)
    const toggle = settings.getByRole('switch', { name: 'Automatic backups' })
    await expect(toggle).toBeDisabled()
    await chooseFolder(app, settings)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => settings.evaluate(() => localStorage.getItem('inkwell-backup-auto'))).toBe('true')
  })
})

test.describe('automatic backup', () => {
  async function boot(page: Page, last?: string) {
    await page.clock.install()
    await page.addInitScript(([dir, last, vault]) => {
      localStorage.setItem('inkwell-backup-dir', dir)
      localStorage.setItem('inkwell-backup-auto', 'true')
      if (last) localStorage.setItem(`inkwell-backup-last:${vault}`, last)
    }, [BACKUPS, last ?? '', VAULT] as const)
    await page.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES })
    await page.goto('/')
    await expect(page.getByText('Groceries', { exact: true }).first()).toBeVisible()
  }
  const count = (page: Page) =>
    page.evaluate((d) => ((window as any).__e2e.list(d) as string[]).filter((n) => n.endsWith('.zip')).length, BACKUPS)

  test('backs up shortly after a vault opens when none exists yet', async ({ page }) => {
    await boot(page)
    expect(await count(page)).toBe(0)
    await page.clock.fastForward(11_000)
    await expect.poll(() => count(page)).toBe(1)
  })

  test('skips when the last backup is under a day old', async ({ page }) => {
    await boot(page, new Date(Date.now() - 60 * 60 * 1000).toISOString())
    await page.clock.fastForward(11_000)
    await page.waitForTimeout(300)
    expect(await count(page)).toBe(0)
  })

  test('backs up again once the last one is over a day old', async ({ page }) => {
    await boot(page, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
    await page.clock.fastForward(11_000)
    await expect.poll(() => count(page)).toBe(1)
  })
})
